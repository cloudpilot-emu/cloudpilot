#ifndef _EVENT_HANDLER_H_
#define _EVENT_HANDLER_H_

#include <SDL2/SDL.h>

#include "ButtonEvent.h"
#include "Platform.h"

class EventHandler {
   public:
    void HandleEvents(long millis);

    bool IsQuit() const;

   private:
    bool UpdatePenPosition();

    void HandlePenDown();

    void HandlePenMove();

    void HandlePenUp();

    void HandleKeyDown(SDL_Event event);

    void HandleButtonKey(SDL_Event event, ButtonEvent::Type type);

    void HandleTextInput(SDL_Event event);

   private:
    bool mouseDown{false};
    long lastMouseMove{Platform::getMilliseconds()};
    int penX{0}, penY{0};
    bool quit{false};
};

#endif  // _EVENT_HANDLER_H_
