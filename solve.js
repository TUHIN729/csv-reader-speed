// Swift CSV Reader — a faster drop-in for csv-reader 1.0.0.
//
// run(input) returns exactly what csv-reader 1.0.0 returns for {text, header}:
// {columns, rows, errors}. Written from scratch against the reference's stated
// policy (see the kit's RULES.txt): BOM dropped, records end at LF/CRLF, empty
// lines are no records, stray CRs outside quotes are dropped (stray_cr), a field
// opening with a quote runs to the next undoubled quote ("" is one quote, CR/LF
// inside read as LF, junk after the closing quote appended as-is with
// quote_junk, a never-closing quote read as a literal with unterminated_quote),
// quotes inside unquoted fields are literal, fields stay strings, rows are
// padded (short_row) or cut (long_row) to the first record's width, and every
// error is {code, line, row} in the order met.
//
// Speed: most records are clean (no quote, no stray CR), so each record is
// first probed with indexOf and, when clean, split in one C++ pass
// (slice + split(',')). Records holding a quote or a stray CR take the careful
// path, which jumps from one special character to the next with a global regex
// and slices field contents instead of building them a character at a time:
// an unquoted field is usually one regex step and one slice, a quoted field
// one step to its closing quote. Nothing is kept from one case to the next.

/** Next special character inside an unquoted field. */
const RE_UNQUOTED = /[,\r\n]/g;
/** Next special character inside a quoted field. */
const RE_QUOTED = /["\r\n]/g;

/** How a field ended: 0 at a comma, 1 at a line break, 2 at the end of the text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const len = text.length;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  // The record being read: the line it starts on and its index in rows (null: the header).
  let recordLine = 1;
  let recordRow = null;
  // How the field just read ended, and its value when read by a helper.
  let ended = COMMA;
  let fieldValue = '';
  let fieldAdded = 0;

  // Reads unquoted characters onto `initial`, from pos, up to the next comma or
  // line break: a CR not followed by LF is dropped (stray_cr). Sets fieldValue,
  // fieldAdded (characters kept beyond `initial`), ended and pos. Only used
  // when a stray CR splits the field; the common case is inlined in the record
  // loop below.
  function readUnquoted(initial) {
    let value = initial;
    let added = 0;
    let p = pos;
    for (;;) {
      RE_UNQUOTED.lastIndex = p;
      const m = RE_UNQUOTED.exec(text);
      if (m === null) {
        if (p < len) {
          value += text.slice(p);
          added += len - p;
        }
        pos = len;
        ended = END;
        break;
      }
      const i = m.index;
      const c = text.charCodeAt(i);
      if (c === 44) {
        if (i > p) {
          value += text.slice(p, i);
          added += i - p;
        }
        pos = i + 1;
        ended = COMMA;
        break;
      }
      if (c === 10) {
        if (i > p) {
          value += text.slice(p, i);
          added += i - p;
        }
        pos = i + 1;
        line += 1;
        ended = LINE_BREAK;
        break;
      }
      if (text.charCodeAt(i + 1) === 10) {
        if (i > p) {
          value += text.slice(p, i);
          added += i - p;
        }
        pos = i + 2;
        line += 1;
        ended = LINE_BREAK;
        break;
      }
      if (i > p) {
        value += text.slice(p, i);
        added += i - p;
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      p = i + 1;
    }
    fieldValue = value;
    fieldAdded = added;
  }

  // What follows a quoted field's closing quote, the quote having closed at p
  // with content `value`: a comma or line break ends the field, anything else
  // is junk read as unquoted. Sets fieldValue, ended and pos.
  function afterClose(value, p) {
    if (p >= len) {
      fieldValue = value;
      ended = END;
      pos = p;
      return;
    }
    const c = text.charCodeAt(p);
    if (c === 44) {
      fieldValue = value;
      ended = COMMA;
      pos = p + 1;
      return;
    }
    if (c === 10) {
      fieldValue = value;
      ended = LINE_BREAK;
      pos = p + 1;
      line += 1;
      return;
    }
    if (c === 13 && text.charCodeAt(p + 1) === 10) {
      fieldValue = value;
      ended = LINE_BREAK;
      pos = p + 2;
      line += 1;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the next
    // comma or line break.
    pos = p;
    readUnquoted(value);
    if (fieldAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  // Reads a quoted field whose opening quote is at pos. Sets fieldValue, ended and pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let p = pos + 1;
    RE_QUOTED.lastIndex = p;
    const first = RE_QUOTED.exec(text);
    if (first === null) {
      // No quote, CR or LF anywhere after the opening quote: it never closes.
      // The rest holds no line break, so the re-read as unquoted runs to the
      // next comma, if any, or the end of the text.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      const ci = text.indexOf(',', open + 1);
      if (ci === -1) {
        fieldValue = '"' + text.slice(open + 1);
        ended = END;
        pos = len;
      } else {
        fieldValue = '"' + text.slice(open + 1, ci);
        ended = COMMA;
        pos = ci + 1;
      }
      return;
    }
    const i = first.index;
    if (text.charCodeAt(i) === 34 && text.charCodeAt(i + 1) !== 34) {
      // The common case: one clean run to the closing quote.
      afterClose(text.slice(p, i), i + 1);
      return;
    }
    // A doubled quote, a CR or an LF inside: accumulate the segments.
    let value = '';
    p = pos + 1;
    for (;;) {
      RE_QUOTED.lastIndex = p;
      const m = RE_QUOTED.exec(text);
      if (m === null) {
        value += text.slice(p);
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        readUnquoted('"');
        return;
      }
      const j = m.index;
      const c = text.charCodeAt(j);
      if (c === 34) {
        if (text.charCodeAt(j + 1) === 34) {
          value += text.slice(p, j) + '"';
          p = j + 2;
          continue;
        }
        value += text.slice(p, j);
        afterClose(value, j + 1);
        return;
      }
      // CR and LF inside quotes are each one LF.
      value += text.slice(p, j) + '\n';
      line += 1;
      p = j + (c === 13 && text.charCodeAt(j + 1) === 10 ? 2 : 1);
    }
  }

  // Finishes a record's fields: a line that held only stray CRs is no record,
  // the first record sets the width (and is the header when header is true),
  // the rest are padded or cut to it.
  function finishRecord(fields, quoted) {
    if (fields.length === 1 && fields[0] === '' && !quoted) return;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the record holds no quote and no stray CR, so it is one slice
    // split at the commas. The line's own CRLF (a CR in the last place before
    // the LF) is the record's end, not content.
    const nl = text.indexOf('\n', pos);
    const segEnd = nl === -1 ? len : nl;
    const contentEnd = nl !== -1 && text.charCodeAt(nl - 1) === 13 ? nl - 1 : segEnd;
    const qi = text.indexOf('"', pos);
    if (qi === -1 || qi >= contentEnd) {
      const ri = text.indexOf('\r', pos);
      if (ri === -1 || ri >= contentEnd) {
        const fields = text.slice(pos, contentEnd).split(',');
        if (nl === -1) {
          pos = len;
        } else {
          pos = nl + 1;
          line += 1;
        }
        finishRecord(fields, false);
        continue;
      }
    }

    // Careful path: the record holds a quote or a stray CR.
    const fields = [];
    let quoted = false;
    do {
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        readQuoted();
        fields.push(fieldValue);
      } else {
        quoted = false;
        // The common case: one regex step to the next comma or line break,
        // one slice. A stray CR falls back to the accumulating reader.
        RE_UNQUOTED.lastIndex = pos;
        const m = RE_UNQUOTED.exec(text);
        if (m === null) {
          fields.push(text.slice(pos));
          pos = len;
          ended = END;
        } else {
          const i = m.index;
          const c = text.charCodeAt(i);
          if (c === 44) {
            fields.push(text.slice(pos, i));
            pos = i + 1;
            ended = COMMA;
          } else if (c === 10) {
            fields.push(text.slice(pos, i));
            pos = i + 1;
            line += 1;
            ended = LINE_BREAK;
          } else if (text.charCodeAt(i + 1) === 10) {
            fields.push(text.slice(pos, i));
            pos = i + 2;
            line += 1;
            ended = LINE_BREAK;
          } else {
            readUnquoted('');
            fields.push(fieldValue);
          }
        }
      }
    } while (ended === COMMA);
    finishRecord(fields, quoted);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
