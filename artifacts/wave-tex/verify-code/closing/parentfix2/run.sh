cd ~/Desktop/Mytherrania; D=artifacts/wave-tex/verify-code/closing/parentfix2
(deno run -A tools/bench-wave-tex.ts --run qc-parentfix2 --out $D/bench --save $D/shots-work > $D/bench.log 2>&1; echo EXIT $? >> $D/bench.log) &
(deno task check > $D/check.txt 2>&1; echo EXIT $? >> $D/check.txt) &
(deno lint > $D/lint.txt 2>&1; echo EXIT $? >> $D/lint.txt) &
(NO_COLOR=1 deno test -A tests/wave_tex_render_test.ts tests/wave_tex_closing_test.ts tests/wave_tex_ui_test.ts tests/wave_tex_marks_test.ts > $D/tests.txt 2>&1; echo EXIT $? >> $D/tests.txt) &
wait
