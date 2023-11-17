#ifndef _PACE_H_
#define _PACE_H_

#include <stdbool.h>
#include <stdint.h>

#include "MMU.h"
#include "mem.h"

#ifdef __cplusplus
extern "C" {
#endif

enum paceStatus {
    pace_status_ok = 0,
    pace_status_illegal_instr = 4,
    pace_status_division_by_zero = 7,
    pace_status_trap0 = 32,
    pace_status_trap8 = 40,
    pace_status_syscall = 47,
    pace_status_line_1111 = 0x0200,
    pace_status_line_1010 = 0x0300,
    pace_status_unimplemented_instr = 0x0100,
    pace_status_memory_fault = 0x0400,
    pace_status_return = 0x1000,
};

void paceInit(struct ArmMem* mem, struct ArmMmu* mmu);

void paceSetStatePtr(uint32_t addr);
uint8_t paceGetFsr();

void paceSetPriviledged(bool priviledged);

bool paceLoad68kState();
bool paceSave68kState();

void paceGetMemeryFault(uint32_t* addr, bool* wasWrite, uint_fast8_t* wasSz, uint_fast8_t* fsr);
uint16_t paceReadTrapWord();

enum paceStatus paceExecute();

#ifdef __cplusplus
}
#endif

#endif  // _PACE_H_
