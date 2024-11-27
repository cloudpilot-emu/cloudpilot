#pragma GCC diagnostic ignored "-Wmissing-field-initializers"

#include "Commands.h"

#include <cstdint>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

#include "Cli.h"
#include "FileUtil.h"
#include "SoC.h"
#include "sdcard.h"

using namespace std;

namespace {
    void CmdSetMips(vector<string> args, cli::CommandEnvironment& env, void* context) {
        if (args.size() != 1) return env.PrintUsage();

        uint32_t mips;
        istringstream s(args[0]);

        s >> mips;

        if (s.fail() || !s.eof()) {
            cout << "invalid argument" << endl;
            return;
        }

        static_cast<commands::Context*>(context)->mainLoop.SetCyclesPerSecondLimit(mips * 1000000);
    }

    void CmdEnableAudio(vector<string> args, cli::CommandEnvironment& env, void* context) {
        static_cast<commands::Context*>(context)->audioDriver.Start();
    }

    void CmdDisableAudio(vector<string> args, cli::CommandEnvironment& env, void* context) {
        static_cast<commands::Context*>(context)->audioDriver.Pause();
    }

    void CmdUnmount(vector<string> args, cli::CommandEnvironment& env, void* context) {
        if (!sdCardInitialized()) {
            cout << "no sd card mounted" << endl;
            return;
        }

        auto ctx = reinterpret_cast<commands::Context*>(context);

        socSdEject(ctx->soc);
        sdCardReset();
    }

    void CmdMount(vector<string> args, cli::CommandEnvironment& env, void* context) {
        if (sdCardInitialized()) {
            cout << "sd card already mounted" << endl;
            return;
        }

        if (args.size() != 1) return env.PrintUsage();

        size_t len{0};
        unique_ptr<uint8_t[]> data;

        if (!util::ReadFile(args[0], data, len)) {
            cout << "failed to read " << args[0];
            return;
        }

        if (len % SD_SECTOR_SIZE) {
            cout << "sd card image has bad size" << endl;
            return;
        }

        auto ctx = reinterpret_cast<commands::Context*>(context);

        sdCardInitializeWithData(len / SD_SECTOR_SIZE, data.release());
        socSdInsert(ctx->soc);
    }

    void CmdReset(vector<string> args, cli::CommandEnvironment& env, void* context) {
        auto ctx = reinterpret_cast<commands::Context*>(context);

        socReset(ctx->soc);
    }

    const vector<cli::Command> commandList(
        {{.name = "set-mips",
          .usage = "set-mips <mips>",
          .description = "Set target MIPS.",
          .cmd = CmdSetMips},
         {.name = "audio-on", .description = "Enable audio.", .cmd = CmdEnableAudio},
         {.name = "audio-off", .description = "Disable audio.", .cmd = CmdDisableAudio},
         {.name = "unmount", .description = "Unmount SD card.", .cmd = CmdUnmount},
         {.name = "mount",
          .usage = "mount <image>",
          .description = "Unmount SD card.",
          .cmd = CmdMount},
         {.name = "reset", .description = "Reset Pilot.", .cmd = CmdReset}});
}  // namespace

void commands::Register() { cli::AddCommands(commandList); }