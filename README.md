# Swift CSV Reader — make.fun `csv-reader-speed-01-run-20261121`

[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/TUHIN729/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/TUHIN729/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

Entry for the make.fun bounty "Read broken CSV files faster" ($100, deadline Mon 23 Nov 2026 08:42 Dhaka): a faster drop-in for make.fun's own csv-reader 1.0.0 that answers exactly as it does on every case.

## What it does

`solve.js` exports `run(input)`, which returns csv-reader 1.0.0's answer `{columns, rows, errors}` for an input `{text, header}`: the BOM is dropped, records end at LF or CRLF, empty lines are no records, stray CRs outside quotes are dropped (`stray_cr`), a field opening with a quote runs to the next undoubled quote (`""` is one quote, CR/LF inside read as LF, junk after the closing quote appended as-is with `quote_junk`, a never-closing quote read as a literal with `unterminated_quote`), quotes inside unquoted fields are literal, fields stay strings, and rows are padded (`short_row`) or cut (`long_row`) to the first record's width. `main.ts` reads every case from `/input/cases.json`, answers each with `run`, and writes `/output/answers.json`.

## How it is fast

- Clean records (no quote, no stray CR) are probed with `indexOf` and split in one C++ pass (`slice` + `split(',')`).
- Records holding a quote or a stray CR are read by jumping from one special character to the next with a global regex and slicing field contents, instead of building them a character at a time: an unquoted field is usually one regex step and one slice, a quoted field one step to its closing quote.
- Nothing is cached from one case to the next; the same input always gives byte-identical output.

## Files

| File | What it is |
| --- | --- |
| `solve.js` | The reader: `run(input)` |
| `main.ts` | The driver the harness runs (`node /bot/main.ts`) |
| `package.json` | `{"type": "module"}` |
| `README.md` | This file |
| `LICENSE` | MIT |

## Run locally

```sh
mkdir -p out
MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

## License

MIT — see `LICENSE`.
