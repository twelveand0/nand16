; =============================================================================
;  NAND-OS 1.0  -  a tiny operating system for the NAND-16 computer
;
;  Registers: r0 = always 0, r1-r3 = arguments / scratch, r4-r5 = preserved
;             across system calls, r6 = link register, r7 = stack pointer
;  Memory:    0x000-0x0FF RAM (0x00-0x0F kernel, 0x10-0x1F apps,
;             0x40-0x7F stack, 0x80-0xFF app buffers)
;             0x100-0x17F video RAM, 64x32 pixels, 4 words per row, MSB left
;             0x200-0x21F GPU shader memory, 0x220 T, 0x221 U, 0x222 GO,
;             0x223 GPU status (bit 0 = busy)
;             0xFFFC KEY  (lo: key-down events since cleared, hi: held keys;
;                         write clears)
;             0xFFFD TIMER (cycles / 64)   0xFFFE RANDOM   0xFFFF LEDS
; =============================================================================

.equ VRAM,      0x100
.equ IO_KEY,    -4
.equ IO_TIMER,  -3
.equ IO_RAND,   -2
.equ IO_LEDS,   -1
.equ STACK_TOP, 128

.equ K_UP,    1
.equ K_DOWN,  2
.equ K_LEFT,  4
.equ K_RIGHT, 8
.equ K_A,     16
.equ K_B,     -32          ; bit 5 (bits 6,7 are not wired to keys)

; ---- the G16 graphics processor ----
.equ G_BASE,  0x220         ; keep this in r2 while talking to the GPU
.equ GP_T,    0
.equ GP_U,    1
.equ GP_GO,   2
.equ GP_STAT, 3
.equ G_END,0
.equ G_LD,1
.equ G_ADD,2
.equ G_SUB,3
.equ G_AND,4
.equ G_OR,5
.equ G_XOR,6
.equ G_SHL,7
.equ G_SHR,8
.equ G_TRI,9
.equ G_STB,10
.equ G_CLT,11
.equ G_PNOT,12
.equ G_PON,13
.equ G_OUT,14
.equ G_DITH,15
.equ S_X,0
.equ S_Y,1
.equ S_T,2
.equ S_U,3
.equ S_B,4
.equ S_I,5
; GI slot, op, src, imm  -  write one shader instruction into GPU memory (r2 = G_BASE)
.macro GI
        LUI  r1, (((\2)<<12)|((\3)<<9)|((\4)&255)) >> 8
        ORL  r1, (((\2)<<12)|((\3)<<9)|((\4)&255)) & 255
        ST   r1, [r2+(\1)-32]
.endm
; rectangle for a GPU draw: rows y0..y1, 16-pixel columns c0..c1
.macro RECT
        LDI  r1, (\1)|((\2)<<5)|((\3)<<10)|((\4)<<12)
.endm

; kernel variables (zero page, reachable as [r0+addr])
.equ Z_CURX,     0
.equ Z_CURY,     1
.equ Z_DEADLINE, 2
.equ Z_HISNAKE,  3
.equ Z_SEL,      4
.equ Z_BEAT,     5

; -----------------------------------------------------------------------------
;  System call table: fixed addresses, the kernel ABI
; -----------------------------------------------------------------------------
reset:      JMP boot
SYS_CLS:    JMP k_cls          ; clear screen, cursor home
SYS_PLOT:   JMP k_plot         ; r1=x r2=y      set pixel
SYS_UNPLOT: JMP k_unplot       ; r1=x r2=y      clear pixel
SYS_TEST:   JMP k_test         ; r1=x r2=y  ->  r1!=0 (NE) if pixel lit
SYS_PUTC:   JMP k_putc         ; r1=char        draw at cursor, advance
SYS_AT:     JMP k_at           ; r1=col r2=row  move text cursor (16x5 grid)
SYS_NUM:    JMP k_num          ; r1=value r2=digits (1-5), leading zeros
SYS_KEY:    JMP k_key          ; -> r1 = new presses (clears), r2 = held keys
SYS_FRAME:  JMP k_frame        ; r1=ticks       sleep until next deadline
SYS_RAND:   JMP k_rand         ; -> r1 random
SYS_EXIT:   JMP k_shell        ; back to the shell
SYS_HLINE:  JMP k_hline        ; r1=y r2=pattern   fill a pixel row
SYS_FLIP:   JMP k_flip         ; r1=x r2=y      invert pixel

; -----------------------------------------------------------------------------
;  Boot: runs from power-on. RAM and video RAM hold random garbage until now.
; -----------------------------------------------------------------------------
boot:
        LI   r7, STACK_TOP
        ST   r0, [r0+IO_KEY]           ; forget any keys latched at power-on
        ; the video RAM still holds whatever the latches fell into at power-on:
        ; leave that snow on screen for a moment while the LEDs sweep
        LD   r1, [r0+IO_TIMER]
        ST   r1, [r0+Z_DEADLINE]
        LI   r4, 1
        LI   r5, 12
@snow:  ST   r4, [r0+IO_LEDS]
        ADD  r4, r4, r4
        SHRI r1, r4, 8
        BEQ  @nx
        LI   r4, 1
@nx:    LI   r1, 8
        CALL k_frame
        DEC  r5
        BNE  @snow
        LI   r1, 255
        ST   r1, [r0+IO_LEDS]
        CALL k_cls
        PRINT "NAND-OS 1.0"
        LI   r1, 0
        LI   r2, 1
        CALL k_at
        PRINT "RAM TEST"
        ; ---- memory test: two passes of address-dependent patterns ----
        LDI  r4, 0xA5C3
        LI   r5, 2
@pass:  LI   r1, 0
@wr:    XOR  r2, r1, r4
        ST   r2, [r1+0]
        INC  r1
        SHRI r3, r1, 8
        BEQ  @wr
        LI   r1, 0
@rd:    LD   r2, [r1+0]
        XOR  r2, r2, r4
        CMP  r2, r1
        BNE  @fail
        SHRI r3, r1, 5
        ST   r3, [r0+IO_LEDS]
        INC  r1
        SHRI r3, r1, 8
        BEQ  @rd
        NOT  r4, r4
        DEC  r5
        BNE  @pass
        ; ---- zero all RAM ----
        LI   r1, 0
@clr:   ST   r0, [r1+0]
        INC  r1
        SHRI r3, r1, 8
        BEQ  @clr
        LI   r1, 9
        LI   r2, 1
        CALL k_at
        PRINT "OK"
        LI   r1, 0
        LI   r2, 2
        CALL k_at
        PRINT "CPU  NAND-16"
        LI   r1, 0
        LI   r2, 3
        CALL k_at
        PRINT "ROM  "
        LDI  r1, ROM_END
        LI   r2, 4
        CALL k_num
        PRINT " WORDS"
        LI   r1, 0
        LI   r2, 4
        CALL k_at
        PRINT "GPU  16 LANES"
        ; ---- GPU self test: draw a checkerboard on the two bottom rows, read it back ----
        LDI  r2, G_BASE
        GI 0, G_LD, S_X, 0
        GI 1, G_XOR, S_Y, 0
        GI 2, G_OUT, S_I, 1
        GI 3, G_END, 0, 0
        RECT 30, 31, 0, 3
        ST   r1, [r2+GP_GO]
@gw:    LD   r1, [r2+GP_STAT]
        TSTI r1, 1
        BNE  @gw
        LDI  r3, VRAM+120
        LD   r1, [r3+0]
        LDI  r2, 0x5555
        CMP  r1, r2
        BNE  @gno
        LD   r1, [r3+7]
        LDI  r2, 0xAAAA
        CMP  r1, r2
        BNE  @gno
        PRINT " OK"
        BRA  @gok
@gno:   PRINT " NO"
@gok:   LD   r1, [r0+IO_TIMER]
        ST   r1, [r0+Z_DEADLINE]
        LI   r1, 60
        CALL k_frame
        ST   r0, [r0+IO_KEY]
        JMP  k_shell
@fail:  MOV  r4, r1
        LI   r1, 0
        LI   r2, 3
        CALL k_at
        PRINT "FAIL AT "
        MOV  r1, r4
        LI   r2, 3
        CALL k_num
        HALT

; -----------------------------------------------------------------------------
;  Shell: menu of programs
; -----------------------------------------------------------------------------
k_shell:
        LI   r7, STACK_TOP
        CALL k_cls
        PRINT "NAND-OS"
        LI   r1, 5
        LI   r2, -1
        CALL k_hline
        LI   r1, 1
        LI   r2, 1
        CALL k_at
        PRINT "SNAKE"
        LI   r1, 1
        LI   r2, 2
        CALL k_at
        PRINT "SKETCH"
        LI   r1, 1
        LI   r2, 3
        CALL k_at
        PRINT "GPU DEMO"
        LI   r1, 1
        LI   r2, 4
        CALL k_at
        PRINT "SYSTEM"
        LI   r5, 1
@loop:  ; draw the selection marker
        LI   r4, 0
@mark:  LI   r1, 0
        ADDI r2, r4, 1
        CALL k_at
        LD   r1, [r0+Z_SEL]
        CMP  r1, r4
        LI   r1, ' '
        BNE  @sp
        LI   r1, '>'
@sp:    CALL k_putc
        INC  r4
        CMPI r4, 4
        BNE  @mark
        ; heartbeat on the LEDs
        ADD  r5, r5, r5
        SHRI r1, r5, 8
        BEQ  @hb
        LI   r5, 1
@hb:    ST   r5, [r0+IO_LEDS]
        LI   r1, 3
        CALL k_frame
        CALL k_key
        LD   r3, [r0+Z_SEL]
        TSTI r1, K_UP
        BEQ  @nu
        DEC  r3
        BPL  @nu
        LI   r3, 3
@nu:    TSTI r1, K_DOWN
        BEQ  @nd
        INC  r3
        CMPI r3, 4
        BNE  @nd
        LI   r3, 0
@nd:    ST   r3, [r0+Z_SEL]
        TSTI r1, K_A
        BEQ  @loop
        LDI  r1, @apps
        ADD  r1, r1, r3
        JR   r1
@apps:  JMP  snake
        JMP  sketch
        JMP  gpudemo
        JMP  sysinfo

; -----------------------------------------------------------------------------
;  Kernel services
; -----------------------------------------------------------------------------
k_cls:
        LUI  r1, 1
        LI   r2, 32
@l:     ST   r0, [r1+0]
        ST   r0, [r1+1]
        ST   r0, [r1+2]
        ST   r0, [r1+3]
        ADDI r1, r1, 4
        DEC  r2
        BNE  @l
        ST   r0, [r0+Z_CURX]
        ST   r0, [r0+Z_CURY]
        RET

; pixel address: r1=x r2=y -> r3=word address, r2=bit mask (clobbers r1)
.macro PIXADDR
        SHLI r3, r2, 2
        SHRI r2, r1, 4
        ADD  r3, r3, r2
        LUI  r2, 1
        ADD  r3, r3, r2
        ANDI r1, r1, 15
        LUI  r2, 0x80
        SHR  r2, r2, r1
.endm
; clip: branch to \1 unless 0<=x<64 and 0<=y<32
.macro CLIP
        SHRI r3, r1, 6
        BNE  \1
        SHRI r3, r2, 5
        BNE  \1
.endm

k_plot:
        CLIP @out
        PIXADDR
        LD   r1, [r3+0]
        OR   r1, r1, r2
        ST   r1, [r3+0]
@out:   RET

k_unplot:
        CLIP @out
        PIXADDR
        LD   r1, [r3+0]
        OR   r1, r1, r2
        XOR  r1, r1, r2
        ST   r1, [r3+0]
@out:   RET

k_flip:
        CLIP @out
        PIXADDR
        LD   r1, [r3+0]
        XOR  r1, r1, r2
        ST   r1, [r3+0]
@out:   RET

k_test:
        CLIP @wall
        PIXADDR
        LD   r1, [r3+0]
        AND  r1, r1, r2
        RET
@wall:  ADDI r1, r0, 1
        RET

k_hline:
        SHLI r1, r1, 2
        LUI  r3, 1
        ADD  r3, r3, r1
        ST   r2, [r3+0]
        ST   r2, [r3+1]
        ST   r2, [r3+2]
        ST   r2, [r3+3]
        RET

k_at:
        ST   r1, [r0+Z_CURX]
        ST   r2, [r0+Z_CURY]
        RET

k_rand:
        LD   r1, [r0+IO_RAND]
        RET

k_key:                             ; -> r1 = keys pressed since last call, r2 = keys held
        LD   r1, [r0+IO_KEY]
        ST   r0, [r0+IO_KEY]
        SHRI r2, r1, 8
        SHLI r1, r1, 8
        SHRI r1, r1, 8
        RET

; sleep until the deadline advances by r1 ticks; resync if we are late
k_frame:
        LD   r2, [r0+Z_DEADLINE]
        ADD  r2, r2, r1
        ST   r2, [r0+Z_DEADLINE]
        LD   r3, [r0+IO_TIMER]
        SUB  r3, r3, r2
        BPL  @late
@wait:  LD   r3, [r0+IO_TIMER]
        SUB  r3, r3, r2
        BMI  @wait
        RET
@late:  LD   r3, [r0+IO_TIMER]
        ST   r3, [r0+Z_DEADLINE]
        RET

; ---- text: 3x5 glyphs in 4x6 cells, 16 columns x 5 rows ----
; one glyph row: take the top 3 bits of r2, place them in the cell, advance
.macro GROW
        SHRI r1, r2, 12
        SHLI r1, r1, 13
        SHR  r1, r1, r4
        LD   r6, [r3+\1]
        OR   r6, r6, r5
        XOR  r6, r6, r5
        OR   r6, r6, r1
        ST   r6, [r3+\1]
        SHLI r2, r2, 4
        SHRI r2, r2, 1
.endm

k_putc:
        PUSH r6
        PUSH r4
        PUSH r5
        SHLI r2, r1, 1
        ADD  r2, r2, r1
        LDI  r3, font
        ADD  r3, r3, r2
        CALLR r3                   ; r2 <- glyph bitmap (code as data)
        LD   r3, [r0+Z_CURY]
        SHLI r4, r3, 4
        SHLI r3, r3, 3
        ADD  r3, r3, r4            ; row * 24 words
        LD   r4, [r0+Z_CURX]
        SHRI r1, r4, 2
        ADD  r3, r3, r1
        LUI  r1, 1
        ADD  r3, r3, r1            ; r3 = first word of the cell
        ANDI r4, r4, 3
        SHLI r4, r4, 2             ; bit offset inside the word
        LUI  r5, 0xF0
        SHR  r5, r5, r4            ; 4-pixel cell mask
        GROW 0
        GROW 4
        GROW 8
        GROW 12
        GROW 16
        LD   r1, [r0+Z_CURX]
        INC  r1
        TSTI r1, 16
        BEQ  @same
        LI   r1, 0
        LD   r2, [r0+Z_CURY]
        INC  r2
        ST   r2, [r0+Z_CURY]
@same:  ST   r1, [r0+Z_CURX]
        POP  r5
        POP  r4
        POP  r6
        RET

; print r1 as exactly r2 decimal digits
k_num:
        PUSH r6
        PUSH r4
        PUSH r5
        MOV  r4, r1
        LI   r3, 5
        SUB  r3, r3, r2
        SHLI r1, r3, 1
        ADD  r1, r1, r3
        LDI  r3, @tab
        ADD  r3, r3, r1
        JR   r3
@tab:   LUI  r5, 0x27
        ORL  r5, 0x10
        CALL k_digit
        LUI  r5, 0x03
        ORL  r5, 0xE8
        CALL k_digit
        LUI  r5, 0
        ORL  r5, 100
        CALL k_digit
        LUI  r5, 0
        ORL  r5, 10
        CALL k_digit
        LUI  r5, 0
        ORL  r5, 1
        CALL k_digit
        POP  r5
        POP  r4
        POP  r6
        RET
k_digit:                           ; r4 = value, r5 = power of ten
        PUSH r6
        LI   r1, 0
@l:     CMP  r4, r5
        BCC  @d
        SUB  r4, r4, r5
        INC  r1
        BRA  @l
@d:     CALL k_putc
        POP  r6
        RET

; -----------------------------------------------------------------------------
;  Character table: PRINT "..." compiles to one CALL per character, into here
; -----------------------------------------------------------------------------
.macro CH
        LI   r1, \1
        JMP  k_putc
.endm
CHARTAB:
        CH 0
        CH 1
        CH 2
        CH 3
        CH 4
        CH 5
        CH 6
        CH 7
        CH 8
        CH 9
        CH 10
        CH 11
        CH 12
        CH 13
        CH 14
        CH 15
        CH 16
        CH 17
        CH 18
        CH 19
        CH 20
        CH 21
        CH 22
        CH 23
        CH 24
        CH 25
        CH 26
        CH 27
        CH 28
        CH 29
        CH 30
        CH 31
        CH 32
        CH 33
        CH 34
        CH 35
        CH 36
        CH 37
        CH 38
        CH 39
        CH 40
        CH 41
        CH 42
        CH 43
        CH 44

; -----------------------------------------------------------------------------
;  Font: 3x5 pixel glyphs. Each entry loads its bitmap into r2 and returns.
; -----------------------------------------------------------------------------
.macro GLYPH
        LUI  r2, ((\1<<12)|(\2<<9)|(\3<<6)|(\4<<3)|\5) >> 8
        ORL  r2, ((\1<<12)|(\2<<9)|(\3<<6)|(\4<<3)|\5) & 255
        RET
.endm
font:
        GLYPH 7,5,5,5,7        ; 0
        GLYPH 2,6,2,2,7        ; 1
        GLYPH 7,1,7,4,7        ; 2
        GLYPH 7,1,7,1,7        ; 3
        GLYPH 5,5,7,1,1        ; 4
        GLYPH 7,4,7,1,7        ; 5
        GLYPH 7,4,7,5,7        ; 6
        GLYPH 7,1,2,2,2        ; 7
        GLYPH 7,5,7,5,7        ; 8
        GLYPH 7,5,7,1,7        ; 9
        GLYPH 2,5,7,5,5        ; A
        GLYPH 6,5,6,5,6        ; B
        GLYPH 3,4,4,4,3        ; C
        GLYPH 6,5,5,5,6        ; D
        GLYPH 7,4,6,4,7        ; E
        GLYPH 7,4,6,4,4        ; F
        GLYPH 3,4,5,5,3        ; G
        GLYPH 5,5,7,5,5        ; H
        GLYPH 7,2,2,2,7        ; I
        GLYPH 1,1,1,5,2        ; J
        GLYPH 5,5,6,5,5        ; K
        GLYPH 4,4,4,4,7        ; L
        GLYPH 5,7,7,5,5        ; M
        GLYPH 6,5,5,5,5        ; N
        GLYPH 2,5,5,5,2        ; O
        GLYPH 6,5,6,4,4        ; P
        GLYPH 2,5,5,6,3        ; Q
        GLYPH 6,5,6,5,5        ; R
        GLYPH 3,4,2,1,6        ; S
        GLYPH 7,2,2,2,2        ; T
        GLYPH 5,5,5,5,7        ; U
        GLYPH 5,5,5,5,2        ; V
        GLYPH 5,5,7,7,5        ; W
        GLYPH 5,5,2,5,5        ; X
        GLYPH 5,5,2,2,2        ; Y
        GLYPH 7,1,2,4,7        ; Z
        GLYPH 0,0,0,0,0        ; space
        GLYPH 0,0,7,0,0        ; -
        GLYPH 0,2,0,2,0        ; :
        GLYPH 2,2,2,0,2        ; !
        GLYPH 0,0,0,0,2        ; .
        GLYPH 4,2,1,2,4        ; >
        GLYPH 1,2,4,2,1        ; <
        GLYPH 6,1,2,0,2        ; ?
        GLYPH 7,7,7,7,7        ; # (block)

; =============================================================================
;  SNAKE
; =============================================================================
.equ S_HEAD,  16
.equ S_TAIL,  17
.equ S_DIR,   18        ; 0 up, 1 down, 2 left, 3 right  (opposite = dir XOR 1)
.equ S_NDIR,  19
.equ S_FOOD,  20
.equ S_SCORE, 21
.equ S_SPEED, 22
.equ RING,    0x80      ; 128-entry ring buffer of body cells (y*32+x)

.macro RINGNEXT         ; r2 = slot after r2 in the ring 0x80..0xFF (clobbers r3)
        INC  r2
        SHRI r3, r2, 8
        BEQ  @rn\@
        LI   r2, RING
@rn\@:
.endm

; cell geometry: 32x12 cells of 2x2 pixels, playfield starts at pixel row 8
.macro CELLADDR         ; r1=cell -> r3=word address (top row), r2=mask
        SHRI r3, r1, 5
        SHLI r3, r3, 3
        SHRI r2, r1, 3
        ANDI r2, r2, 3
        ADD  r3, r3, r2
        LDI  r2, VRAM+32
        ADD  r3, r3, r2
        ANDI r1, r1, 7
        ADD  r1, r1, r1
        LUI  r2, 0xC0
        SHR  r2, r2, r1
.endm

snake:
        CALL k_cls
        PRINT "SCORE"
        LI   r1, 10
        LI   r2, 0
        CALL k_at
        PRINT "HI"
        LI   r1, 6
        LI   r2, -1
        CALL k_hline
        ; a 3-cell snake heading right
        LI   r4, RING
        LI   r1, 200
        ST   r1, [r4+0]
        CALL cell_on
        LI   r1, 201
        ST   r1, [r4+1]
        CALL cell_on
        LI   r1, 202
        ST   r1, [r4+2]
        CALL cell_on
        ADDI r1, r4, 2
        ST   r1, [r0+S_HEAD]
        ST   r4, [r0+S_TAIL]
        LI   r1, 3
        ST   r1, [r0+S_DIR]
        ST   r1, [r0+S_NDIR]
        ST   r0, [r0+S_SCORE]
        LI   r1, 9
        ST   r1, [r0+S_SPEED]
        ST   r0, [r0+IO_LEDS]
        CALL draw_score
        CALL place_food
        LD   r1, [r0+IO_TIMER]
        ST   r1, [r0+Z_DEADLINE]

@loop:  LD   r4, [r0+S_SPEED]
@tick:  LI   r1, 1
        CALL k_frame
        CALL k_key
        BEQ  @nokey
        TSTI r1, K_B
        BNE  @quit
        LD   r3, [r0+S_DIR]
        TSTI r1, K_UP
        BEQ  @k1
        LI   r2, 0
        BRA  @set
@k1:    TSTI r1, K_DOWN
        BEQ  @k2
        LI   r2, 1
        BRA  @set
@k2:    TSTI r1, K_LEFT
        BEQ  @k3
        LI   r2, 2
        BRA  @set
@k3:    TSTI r1, K_RIGHT
        BEQ  @nokey
        LI   r2, 3
@set:   XOR  r1, r2, r3
        CMPI r1, 1
        BEQ  @nokey                ; no reversing into yourself
        ST   r2, [r0+S_NDIR]
@nokey: DEC  r4
        BNE  @tick

        ; ---- move ----
        LD   r1, [r0+S_NDIR]
        ST   r1, [r0+S_DIR]
        LD   r2, [r0+S_HEAD]
        LD   r5, [r2+0]            ; r5 = head cell
        CMPI r1, 2
        BCS  @horiz
        CMPI r1, 1
        BEQ  @down
        CMPI r5, 32                ; up
        BCC  @dead
        ADDI r5, r5, -32
        BRA  @moved
@down:  LDI  r2, 352
        CMP  r5, r2
        BCS  @dead
        ADDI r5, r5, 16
        ADDI r5, r5, 16
        BRA  @moved
@horiz: ANDI r2, r5, 31
        CMPI r1, 3
        BEQ  @right
        CMPI r2, 0                 ; left
        BEQ  @dead
        DEC  r5
        BRA  @moved
@right: CMPI r2, 31
        BEQ  @dead
        INC  r5
@moved: LD   r1, [r0+S_FOOD]
        CMP  r5, r1
        BEQ  @eat
        ; move the tail forward (erase last cell)
        LD   r2, [r0+S_TAIL]
        LD   r1, [r2+0]
        RINGNEXT
        ST   r2, [r0+S_TAIL]
        CALL cell_off
        MOV  r1, r5
        CALL cell_test
        BNE  @dead
        MOV  r1, r5
        CALL cell_on
        LD   r2, [r0+S_HEAD]
        RINGNEXT
        ST   r2, [r0+S_HEAD]
        ST   r5, [r2+0]
        JMP  @loop

@eat:   LD   r1, [r0+S_SCORE]
        INC  r1
        ST   r1, [r0+S_SCORE]
        ST   r1, [r0+IO_LEDS]
        ANDI r1, r1, 3             ; speed up every 4 apples
        BNE  @nosp
        LD   r1, [r0+S_SPEED]
        CMPI r1, 3
        BEQ  @nosp
        DEC  r1
        ST   r1, [r0+S_SPEED]
@nosp:  ; ring nearly full? then grow no further
        LD   r1, [r0+S_HEAD]
        LD   r2, [r0+S_TAIL]
        SUB  r1, r1, r2
        LI   r2, 127
        AND  r1, r1, r2
        LI   r2, 120
        CMP  r1, r2
        BCC  @room
        LD   r2, [r0+S_TAIL]
        LD   r1, [r2+0]
        RINGNEXT
        ST   r2, [r0+S_TAIL]
        CALL cell_off
@room:  MOV  r1, r5
        CALL cell_on
        LD   r2, [r0+S_HEAD]
        RINGNEXT
        ST   r2, [r0+S_HEAD]
        ST   r5, [r2+0]
        CALL draw_score
        CALL place_food
        JMP  @loop

@dead:  LD   r1, [r0+S_SCORE]
        LD   r2, [r0+Z_HISNAKE]
        CMP  r2, r1
        BCS  @nohi
        ST   r1, [r0+Z_HISNAKE]
@nohi:  CALL draw_score
        LI   r1, 3
        LI   r2, 2
        CALL k_at
        PRINT "GAME OVER"
        LI   r1, 1
        LI   r2, 4
        CALL k_at
        PRINT "A AGAIN  B MENU"
@wait:  LI   r1, 2
        CALL k_frame
        CALL k_key
        TSTI r1, K_A
        BNE  snake
        TSTI r1, K_B
        BEQ  @wait
@quit:  JMP  k_shell

draw_score:
        PUSH r6
        LI   r1, 6
        LI   r2, 0
        CALL k_at
        LD   r1, [r0+S_SCORE]
        LI   r2, 3
        CALL k_num
        LI   r1, 13
        LI   r2, 0
        CALL k_at
        LD   r1, [r0+Z_HISNAKE]
        LI   r2, 3
        CALL k_num
        POP  r6
        RET

place_food:
        PUSH r6
@try:   LD   r1, [r0+IO_RAND]
        SHRI r1, r1, 7             ; 0..511
        LDI  r2, 384
        CMP  r1, r2
        BCS  @try
        ST   r1, [r0+S_FOOD]
        CALL cell_test
        BNE  @try
        LD   r1, [r0+S_FOOD]
        CELLADDR
        SHRI r1, r2, 1
        AND  r1, r1, r2            ; right pixel
        XOR  r2, r2, r1            ; left pixel
        LD   r6, [r3+0]
        OR   r6, r6, r2
        ST   r6, [r3+0]
        LD   r6, [r3+4]
        OR   r6, r6, r1
        ST   r6, [r3+4]
        POP  r6
        RET

cell_on:
        CELLADDR
        LD   r1, [r3+0]
        OR   r1, r1, r2
        ST   r1, [r3+0]
        LD   r1, [r3+4]
        OR   r1, r1, r2
        ST   r1, [r3+4]
        RET
cell_off:
        CELLADDR
        LD   r1, [r3+0]
        OR   r1, r1, r2
        XOR  r1, r1, r2
        ST   r1, [r3+0]
        LD   r1, [r3+4]
        OR   r1, r1, r2
        XOR  r1, r1, r2
        ST   r1, [r3+4]
        RET
cell_test:
        CELLADDR
        LD   r1, [r3+0]
        AND  r1, r1, r2
        RET

; =============================================================================
;  SKETCH - an etch-a-sketch. Arrows move, A switches pen, B exits.
; =============================================================================
.equ D_X, 16
.equ D_Y, 17
.equ D_PEN, 18          ; 0 draw, 1 erase, 2 lift
sketch:
        CALL k_cls
        PRINT "SKETCH"
        LI   r1, 0
        LI   r2, 4
        CALL k_at
        PRINT "A PEN  B EXIT"
        LI   r1, 32
        ST   r1, [r0+D_X]
        LI   r1, 16
        ST   r1, [r0+D_Y]
        ST   r0, [r0+D_PEN]
        ST   r0, [r0+IO_LEDS]
@loop:  LD   r1, [r0+D_X]           ; show cursor
        LD   r2, [r0+D_Y]
        CALL k_flip
        LI   r1, 2
        CALL k_frame
        LD   r1, [r0+D_X]           ; hide cursor
        LD   r2, [r0+D_Y]
        CALL k_flip
        CALL k_key
        TSTI r1, K_B
        BNE  @quit
        TSTI r1, K_A
        BEQ  @nopen
        LD   r3, [r0+D_PEN]
        INC  r3
        CMPI r3, 3
        BNE  @pw
        LI   r3, 0
@pw:    ST   r3, [r0+D_PEN]
        LI   r1, 1
        SHL  r3, r1, r3
        ST   r3, [r0+IO_LEDS]
@nopen: OR   r2, r2, r1             ; held or freshly pressed
        LD   r4, [r0+D_X]
        LD   r5, [r0+D_Y]
        TSTI r2, K_LEFT
        BEQ  @a
        CMPI r4, 0
        BEQ  @a
        DEC  r4
@a:     TSTI r2, K_RIGHT
        BEQ  @b
        ADDI r3, r4, 1
        SHRI r3, r3, 6
        BNE  @b
        INC  r4
@b:     TSTI r2, K_UP
        BEQ  @c
        CMPI r5, 0
        BEQ  @c
        DEC  r5
@c:     TSTI r2, K_DOWN
        BEQ  @d
        CMPI r5, 31
        BEQ  @d
        INC  r5
@d:     ST   r4, [r0+D_X]
        ST   r5, [r0+D_Y]
        MOV  r1, r4
        MOV  r2, r5
        LD   r3, [r0+D_PEN]
        CMPI r3, 1
        BEQ  @erase
        BCS  @loop
        CALL k_plot
        JMP  @loop
@erase: CALL k_unplot
        JMP  @loop
@quit:  JMP  k_shell

; =============================================================================
;  GPU DEMO - shader programs running on the G16's 16 lanes.
;  LEFT / RIGHT / A: next effect.  B: back to the menu.
;  "MUNCH CPU" draws the same picture as "MUNCH GPU" with the CPU alone.
;  "LAB" uploads nothing: it runs whatever shader is in GPU memory, so a
;  program burned in through the GPU's debug port shows up here.
;  The number is how many clock cycles the last frame took.
; =============================================================================
.equ E_EFF, 16
.equ E_T,   17
.equ E_T0,  18
.equ E_CYC, 19
.equ E_U,   20
.equ E_DU,  21
.equ N_EFF, 6
gpudemo:
        ST   r0, [r0+E_EFF]
        LI   r1, 32
        ST   r1, [r0+E_U]
        LI   r1, 1
        ST   r1, [r0+E_DU]
@new:   CALL k_cls
        LI   r1, 5
        LI   r2, -1
        CALL k_hline
        ST   r0, [r0+E_CYC]
        LD   r1, [r0+E_EFF]
        LI   r3, 1
        SHL  r3, r3, r1
        ST   r3, [r0+IO_LEDS]
        LDI  r3, @tab
        ADD  r3, r3, r1
        JR   r3
@tab:   JMP  @e0
        JMP  @e1
        JMP  @e2
        JMP  @e3
        JMP  @e4
        JMP  @e5

; ---- MUNCH: pixel on where (x XOR y) < t  (5 instructions)
@e0:    LDI  r2, G_BASE
        GI 0, G_LD, S_X, 0
        GI 1, G_XOR, S_Y, 0
        GI 2, G_SUB, S_T, 0
        GI 3, G_OUT, S_I, 128
        GI 4, G_END, 0, 0
        PRINT "MUNCH GPU"
        JMP  @loop
@e1:    PRINT "MUNCH CPU"
        JMP  @loop
; ---- RINGS: diamond distance from a moving centre, banded
@e2:    LDI  r2, G_BASE
        GI 0, G_LD, S_X, 0
        GI 1, G_SUB, S_U, 0
        GI 2, G_TRI, 0, 0
        GI 3, G_STB, 0, 0
        GI 4, G_LD, S_Y, 0
        GI 5, G_SUB, S_I, 19
        GI 6, G_TRI, 0, 0
        GI 7, G_ADD, S_B, 0
        GI 8, G_SUB, S_T, 0
        GI 9, G_OUT, S_I, 4
        GI 10, G_END, 0, 0
        PRINT "RINGS GPU"
        JMP  @loop
; ---- WAVES: three triangle waves summed, then ordered dither
@e3:    LDI  r2, G_BASE
        GI 0, G_LD, S_X, 0
        GI 1, G_ADD, S_T, 0
        GI 2, G_SHL, 0, 0
        GI 3, G_TRI, 0, 0
        GI 4, G_SHR, 0, 0
        GI 5, G_STB, 0, 0
        GI 6, G_LD, S_Y, 0
        GI 7, G_SHL, 0, 0
        GI 8, G_SHL, 0, 0
        GI 9, G_SHL, 0, 0
        GI 10, G_SUB, S_U, 0
        GI 11, G_TRI, 0, 0
        GI 12, G_SHR, 0, 0
        GI 13, G_ADD, S_B, 0
        GI 14, G_STB, 0, 0
        GI 15, G_LD, S_X, 0
        GI 16, G_ADD, S_Y, 0
        GI 17, G_SHL, 0, 0
        GI 18, G_SUB, S_T, 0
        GI 19, G_TRI, 0, 0
        GI 20, G_ADD, S_B, 0
        GI 21, G_DITH, 0, 0
        GI 22, G_END, 0, 0
        PRINT "WAVES GPU"
        JMP  @loop
; ---- SIMT: lanes inside the ball and outside it take different paths
@e4:    LDI  r2, G_BASE
        GI 0, G_LD, S_X, 0
        GI 1, G_SUB, S_U, 0
        GI 2, G_TRI, 0, 0
        GI 3, G_STB, 0, 0
        GI 4, G_LD, S_Y, 0
        GI 5, G_SUB, S_I, 19
        GI 6, G_TRI, 0, 0
        GI 7, G_ADD, S_B, 0         ; acc = distance from the centre
        GI 8, G_CLT, S_I, 12        ; mask: lanes inside the ball
        GI 9, G_PNOT, 0, 0          ; flip: lanes outside run first
        GI 10, G_LD, S_X, 0
        GI 11, G_ADD, S_Y, 0
        GI 12, G_ADD, S_T, 0
        GI 13, G_OUT, S_I, 8        ; scrolling stripes
        GI 14, G_PNOT, 0, 0         ; flip: now the lanes inside
        GI 15, G_XOR, S_I, 15       ; their acc still holds the distance
        GI 16, G_SHL, 0, 0
        GI 17, G_SHL, 0, 0
        GI 18, G_SHL, 0, 0
        GI 19, G_SHL, 0, 0
        GI 20, G_DITH, 0, 0         ; shaded sphere
        GI 21, G_END, 0, 0
        PRINT "SIMT  GPU"
        JMP  @loop
; ---- LAB: the shader memory is left alone
@e5:    PRINT "LAB   GPU"

; ---- one frame
@loop:  LD   r1, [r0+E_U]           ; bounce the U uniform between 14 and 50
        LD   r3, [r0+E_DU]
        ADD  r1, r1, r3
        CMPI r1, 14
        BEQ  @flip
        LI   r2, 50
        CMP  r1, r2
        BNE  @uok
@flip:  NEG  r3, r3
        ST   r3, [r0+E_DU]
@uok:   ST   r1, [r0+E_U]
        LD   r1, [r0+IO_TIMER]
        ST   r1, [r0+E_T0]
        LD   r4, [r0+E_EFF]
        LD   r1, [r0+E_T]
        CMPI r4, 2
        BCS  @full
        SHLI r1, r1, 10             ; munching squares use t mod 64
        SHRI r1, r1, 10
@full:  CMPI r4, 1
        BEQ  @cpu
        LDI  r2, G_BASE
        ST   r1, [r2+GP_T]
        LD   r1, [r0+E_U]
        ST   r1, [r2+GP_U]
        RECT 6, 31, 0, 3
        ST   r1, [r2+GP_GO]         ; one store: the GPU draws 104 words by itself
@wait:  LD   r1, [r2+GP_STAT]
        TSTI r1, 1
        BNE  @wait
        BRA  @done

; ---- the same MUNCH picture, computed by the CPU one pixel at a time
@cpu:   MOV  r3, r1
        LI   r4, 6                  ; y
@cy:    LI   r5, 0                  ; 16-pixel column
@cc:    SHLI r1, r5, 4              ; x
        LI   r6, 0
@px:    XOR  r2, r1, r4
        SUB  r2, r2, r3
        SHRI r2, r2, 15             ; 1 if (x XOR y) < t
        ADD  r6, r6, r6
        OR   r6, r6, r2
        INC  r1
        ANDI r2, r1, 15
        BNE  @px
        SHLI r2, r4, 2
        ADD  r2, r2, r5
        LUI  r1, 1
        ADD  r2, r2, r1
        ST   r6, [r2+0]
        INC  r5
        CMPI r5, 4
        BNE  @cc
        LD   r2, [r0+IO_KEY]        ; a key? stop early, the loop below handles it
        SHLI r2, r2, 8
        BNE  @done
        INC  r4
        CMPI r4, 32
        BNE  @cy

@done:  LD   r1, [r0+IO_TIMER]
        LD   r3, [r0+E_T0]
        SUB  r1, r1, r3
        SHRI r3, r1, 10
        BEQ  @fit
        LDI  r1, 1023
@fit:   SHLI r1, r1, 6              ; timer ticks -> clock cycles
        ST   r1, [r0+E_CYC]
        LD   r1, [r0+E_T]
        INC  r1
        ST   r1, [r0+E_T]
        LD   r4, [r0+E_EFF]         ; show the cost (every 4th GPU frame, every CPU frame)
        CMPI r4, 1
        BEQ  @show
        ANDI r1, r1, 3
        BNE  @keys
@show:  LI   r1, 10
        LI   r2, 0
        CALL k_at
        LD   r1, [r0+E_CYC]
        LI   r2, 5
        CALL k_num
@keys:  CALL k_key
        TSTI r1, K_B
        BNE  @quit
        LD   r3, [r0+E_EFF]
        TSTI r1, K_RIGHT|K_A
        BEQ  @nr
        INC  r3
        CMPI r3, N_EFF
        BNE  @set
        LI   r3, 0
        BRA  @set
@nr:    TSTI r1, K_LEFT
        BNE  @prev
        JMP  @loop
@prev:  DEC  r3
        BPL  @set
        LI   r3, N_EFF-1
@set:   ST   r3, [r0+E_EFF]
        JMP  @new
@quit:  JMP  k_shell

; =============================================================================
;  SYSTEM - live machine status
; =============================================================================
sysinfo:
        CALL k_cls
        PRINT "NAND-16 SYSTEM"
        LI   r1, 5
        LI   r2, -1
        CALL k_hline
        LI   r1, 0
        LI   r2, 1
        CALL k_at
        PRINT "TICKS"
        LI   r1, 0
        LI   r2, 2
        CALL k_at
        PRINT "RAND"
        LI   r1, 0
        LI   r2, 3
        CALL k_at
        PRINT "KEYS"
        LI   r1, 0
        LI   r2, 4
        CALL k_at
        PRINT "B EXIT"
@loop:  LI   r1, 8
        LI   r2, 1
        CALL k_at
        LD   r1, [r0+IO_TIMER]
        LI   r2, 5
        CALL k_num
        LI   r1, 8
        LI   r2, 2
        CALL k_at
        LD   r1, [r0+IO_RAND]
        LI   r2, 5
        CALL k_num
        LI   r1, 8
        LI   r2, 3
        CALL k_at
        CALL k_key
        MOV  r4, r1
        ST   r2, [r0+IO_LEDS]
        MOV  r5, r2
        ORL  r5, 0x40              ; sentinel: stop after 6 key bits
@bits:  ANDI r1, r5, 1
        LI   r1, '-'
        BEQ  @z
        LI   r1, '#'
@z:     CALL k_putc
        SHRI r5, r5, 1
        CMPI r5, 1
        BNE  @bits
        TSTI r4, K_B
        BNE  @quit
        LI   r1, 4
        CALL k_frame
        JMP  @loop
@quit:  JMP  k_shell

ROM_END:
