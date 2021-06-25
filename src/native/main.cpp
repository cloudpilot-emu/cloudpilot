#include <SDL.h>
#include <SDL_image.h>

#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <memory>
#include <string>

#include "Cli.h"
#include "EmCommon.h"
#include "EmDevice.h"
#include "EmROMReader.h"
#include "EmSession.h"
#include "Feature.h"
#include "MainLoop.h"
#include "ProxyClient.h"
#include "ScreenDimensions.h"
#include "SessionImage.h"
#include "SuspendContextClipboardCopy.h"
#include "SuspendContextClipboardPaste.h"
#include "SuspendContextNetworkConnect.h"
#include "SuspendContextNetworkDisconnect.h"
#include "SuspendContextNetworkRpc.h"
#include "SuspendManager.h"
#include "argparse/argparse.h"
#include "uri/uri.h"
#include "util.h"

using namespace std;

struct ProxyConfiguration {
    string host;
    long port;
    string path;
};

struct Options {
    string image;
    optional<string> deviceId;
    optional<ProxyConfiguration> proxyConfiguration;
    bool traceNetlib;
};

void handleSuspend(ProxyClient* proxyClient) {
    if (!SuspendManager::IsSuspended()) return;

    SuspendContext& context = SuspendManager::GetContext();

    switch (context.GetKind()) {
        case SuspendContext::Kind::clipboardCopy:
            SDL_SetClipboardText(context.AsContextClipboardCopy().GetClipboardContent());

            context.AsContextClipboardCopy().Resume();

            break;

        case SuspendContext::Kind::clipboardPaste: {
            const char* clipboardContent = SDL_GetClipboardText();

            context.AsContextClipboardPaste().Resume(clipboardContent ? clipboardContent : "");

            break;
        }

        case SuspendContext::Kind::networkConnect:
            EmAssert(proxyClient);

            if (proxyClient->Connect()) {
                context.AsContextNetworkConnect().Resume();

                cout << "network proxy connected" << endl << flush;
            } else {
                context.Cancel();

                cout << "failed to connect to network proxy" << endl << flush;
            }

            break;

        case SuspendContext::Kind::networkDisconnect:
            EmAssert(proxyClient);

            proxyClient->Disconnect();
            context.AsContextNetworkDisconnect().Resume();

            cout << "network proxy disconnected" << endl << flush;

            break;

        case SuspendContext::Kind::networkRpc: {
            {
                EmAssert(proxyClient);

                auto [request, size] = context.AsContextNetworkRpc().GetRequest();

                if (!proxyClient->Send(request, size)) {
                    context.Cancel();

                    break;
                }

                auto [responseBuffer, responseSize] = proxyClient->Receive();

                if (responseBuffer) {
                    context.AsContextNetworkRpc().ReceiveResponse(responseBuffer, responseSize);
                    delete[] responseBuffer;
                } else
                    context.Cancel();

                break;
            }
        }
    }
}

void run(const Options& options) {
    if (!(options.deviceId ? util::initializeSession(options.image, *options.deviceId)
                           : util::initializeSession(options.image)))
        exit(1);

    ProxyClient* proxyClient = nullptr;

    if (options.proxyConfiguration) {
        proxyClient =
            ProxyClient::Create(options.proxyConfiguration->host, options.proxyConfiguration->port,
                                options.proxyConfiguration->path);

        Feature::SetNetworkRedirection(true);
    }

    Feature::SetClipboardIntegration(true);

    srand(time(nullptr));

    SDL_Init(SDL_INIT_VIDEO | SDL_INIT_EVENTS);
    IMG_Init(IMG_INIT_PNG);
    SDL_StartTextInput();

    SDL_Window* window;
    SDL_Renderer* renderer;

    ScreenDimensions::Kind screenDimensionsKind = gSession->GetDevice().GetScreenDimensions();
    ScreenDimensions screenDimensions(screenDimensionsKind);
    int scale = screenDimensionsKind == ScreenDimensions::screen320x320 ? 2 : 3;

    if (SDL_CreateWindowAndRenderer(
            screenDimensions.Width() * scale,
            (screenDimensions.Height() + screenDimensions.SilkscreenHeight()) * scale, 0, &window,
            &renderer) != 0) {
        cerr << "unable to create SDL window: " << SDL_GetError() << endl;
        exit(1);
    }

    MainLoop mainLoop(window, renderer, scale);

    Cli::Start();

    while (mainLoop.IsRunning()) {
        mainLoop.Cycle();

        if (Cli::Execute()) break;

        handleSuspend(proxyClient);
    };

    Cli::Stop();
    if (proxyClient) proxyClient->Disconnect();

    SDL_Quit();
    IMG_Quit();
}

int main(int argc, const char** argv) {
    class bad_device_id : public exception {};

    argparse::ArgumentParser program("cloudpilot");

    program.add_description("Cloudpilot is an emulator for dragonball-based PalmOS devices.");

    program.add_argument("image").help("image or ROM file").required();

    program.add_argument("--device-id", "-d")
        .help("specify device ID")
        .action([](const string& value) -> string {
            for (auto& deviceId : util::SUPPORTED_DEVICES)
                if (value == deviceId) return deviceId;

            throw bad_device_id();
        });

    program.add_argument("--net-proxy", "-n")
        .help("enable network redirection via specified proxy URI")
        .action([](const string& value) {
            try {
                uri parsed(value);

                string scheme = parsed.get_scheme();
                string host = parsed.get_host();
                long port = parsed.get_port();
                string path = parsed.get_path();
                string query = parsed.get_query();

                if (!query.empty()) path += "?" + query;

                if (scheme != "http") throw runtime_error("bad URI scheme - must be http");

                return ProxyConfiguration{host, port > 0 ? port : 80, path.empty() ? "/" : path};
            } catch (const invalid_argument& e) {
                throw runtime_error("invalid proxy URI");
            }
        });

    program.add_argument("--net-trace")
        .help("trace network API")
        .default_value(false)
        .implicit_value(true);

    try {
        program.parse_args(argc, argv);
    } catch (const bad_device_id& e) {
        cerr << "bad device ID; valid IDs are:" << endl;

        for (auto& deviceId : util::SUPPORTED_DEVICES) cerr << "  " << deviceId << endl;

        exit(1);
    } catch (const runtime_error& e) {
        cerr << e.what() << endl << endl;
        cerr << program;

        exit(1);
    }

    Options options;

    options.image = program.get("image");
    if (auto deviceId = program.present("--device-id")) options.deviceId = *deviceId;
    if (auto proxyConfiguration = program.present<ProxyConfiguration>("--net-proxy"))
        options.proxyConfiguration = *proxyConfiguration;

    run(options);
}
