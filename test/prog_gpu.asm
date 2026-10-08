; exercise the G16 GPU: every shader op, masks, stalls, queued draws
.equ S_X,0
.equ S_Y,1
.equ S_T,2
.equ S_U,3
.equ S_B,4
.equ S_I,5
.macro GI            ; GI slot, op, src, imm
        LUI  r1, (((\2)<<12)|((\3)<<9)|((\4)&255)) >> 8
        ORL  r1, (((\2)<<12)|((\3)<<9)|((\4)&255)) & 255
        ST   r1, [r2+(\1)-32]
.endm
        LI   r7, 127
        LDI  r2, 0x220
        ; shader 1: every ALU op, predication, OUT, DITH
        GI 0, 1, S_X, 0         ; LD X
        GI 1, 2, S_T, 0         ; ADD T
        GI 2, 7, 0, 0           ; SHL
        GI 3, 9, 0, 0           ; TRI
        GI 4, 10, 0, 0          ; STB
        GI 5, 1, S_Y, 0         ; LD Y
        GI 6, 3, S_U, 0         ; SUB U
        GI 7, 9, 0, 0           ; TRI
        GI 8, 2, S_B, 0         ; ADD B
        GI 9, 11, S_I, 70       ; CLT #70
        GI 10, 6, S_I, 0x5A     ; XOR #5A  (masked lanes only)
        GI 11, 12, 0, 0         ; PNOT
        GI 12, 4, S_I, 0xF0     ; AND #F0
        GI 13, 5, S_I, 3        ; OR #3
        GI 14, 8, 0, 0          ; SHR
        GI 15, 13, 0, 0         ; PON
        GI 16, 15, 0, 0         ; DITH
        GI 17, 11, S_X, 0       ; CLT X
        GI 18, 14, S_I, 0x24    ; OUT #24
        GI 19, 0, 0, 0          ; END
        LI   r1, 37
        ST   r1, [r2+0]         ; T
        LI   r1, 21
        ST   r1, [r2+1]         ; U
        LDI  r1, 2|(7<<5)|(1<<10)|(3<<12)
        ST   r1, [r2+2]         ; GO rows 2..7, cols 1..3
        ; while it runs, hammer video RAM from the CPU (forces GPU stalls)
        LUI  r3, 1
        LI   r4, 40
@h:     ST   r4, [r3+0]
        ST   r4, [r3+5]
        LD   r5, [r3+9]
        DEC  r4
        BNE  @h
        ; queue a second draw while the first may still be running
        LDI  r1, 20|(25<<5)|(0<<10)|(1<<12)
        ST   r1, [r2+2]
@w:     LD   r1, [r2+3]
        TSTI r1, 1
        BNE  @w
        ; shader 2: munching squares over the whole screen
        GI 0, 1, S_X, 0
        GI 1, 6, S_Y, 0
        GI 2, 3, S_T, 0
        GI 3, 14, S_I, 128
        GI 4, 0, 0, 0
        LI   r5, 0
@f:     ST   r5, [r2+0]
        LDI  r1, 0|(31<<5)|(0<<10)|(3<<12)
        ST   r1, [r2+2]
@w2:    LD   r1, [r2+3]
        TSTI r1, 1
        BNE  @w2
        LD   r1, [r0+-3]        ; I/O still works (timer)
        ADDI r5, r5, 9
        CMPI r5, 27
        BCC  @f
        JMP  0
