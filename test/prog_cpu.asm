; exercise every instruction
        LI   r7, 128
        LI   r1, 1
        LI   r2, 1
        LI   r5, 20
fib:    ADD  r3, r1, r2
        MOV  r1, r2
        MOV  r2, r3
        ST   r3, [r5+10]
        DEC  r5
        BNE  fib
        LDI  r4, 0x1234
        LDI  r3, -300
        ADD  r1, r4, r3
        SUB  r2, r4, r3
        AND  r1, r1, r2
        OR   r1, r1, r4
        XOR  r1, r1, r3
        LI   r2, 5
        SHL  r3, r4, r2
        SHR  r3, r4, r2
        SAR  r3, r3, r2
        LDI  r3, 0x8421
        SAR  r1, r3, r2
        SHLI r1, r3, 3
        SHRI r1, r3, 7
        SARI r1, r3, 15
        ANDI r1, r3, -8
        ANDI r1, r3, 13
        CMP  r1, r3
        BLT  @l1
        NOP
@l1:    CMPI r1, 5
        BCS  @l2
        INC  r1
@l2:    CALL sub1
        LDI  r2, sub1
        CALLR r2
        LUI  r1, 0x01
        ORL  r1, 0x05
        LI   r3, 0x55
        ST   r3, [r1]
        LD   r2, [r1]
        ST   r2, [r0+3]
        LD   r4, [r0+3]
        LD   r4, [r0-2]   ; RAND
        LD   r4, [r0-3]   ; TIMER
        LI   r3, 0x5A
        ST   r3, [r0-1]   ; LEDS
        LD   r4, [r0-1]
        PUSH r4
        POP  r5
        ; memory sweep
        LI   r1, 0
        LDI  r2, 0x3A5
@sw:    ST   r2, [r1+0]
        LD   r3, [r1+0]
        ADD  r2, r2, r3
        ADDI r1, r1, 7
        LI   r5, 250
        CMP  r1, r5
        BCC  @sw
        LUI  r1, 1
        LI   r4, 100
@vs:    ST   r4, [r1+0]
        ADDI r1, r1, 3
        DEC  r4
        BPL  @vs
        JMP  0
sub1:   ADDI r1, r1, 3
        NEG  r2, r1
        NOT  r3, r1
        RET
