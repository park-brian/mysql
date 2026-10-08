// ICU's pattern language, as 8.4.11 read each of these patterns.
//
// `icu-pattern.ts` parses ICU's syntax and writes the engine's; this pins
// what it reads. Every refusal with ICU's own number and, for a syntax
// error, the line and character ICU stopped at: a quantifier with nothing
// to repeat or after another, a lone `{` or `}`, an interval missing a part
// (3692) or past 16,777,215 (4007), an unknown flag (3688) or an unfinished
// flag group (3900), a group name with a bad character (3887), a
// backreference past the last group (3694), an unbounded lookbehind (3695),
// a bad escape (3689), a reversed range (3697). And what it accepts:
// `\Q…\E`, `(?#…)`, `(?x)` inside brackets and intervals, flags switched
// mid-pattern and scoped, possessive quantifiers and atomic groups,
// `&&` and `--` between sets, `[:alpha:]` with no outer brackets, loosely
// named properties, `\x{…}`, `\0ooo`, `\cX`, `\h`, `\v`, `\R`, `\A`, `\z`,
// `\Z`, `$` before a final newline, Unicode's `\b`; and REGEXP_REPLACE's
// `$n` taking digits while they name a group, `${name}`, `\uhhhh` and a
// trailing `\` (found by review).
import { test } from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { MySQL } from "@myjs/core";

type Outcome =
  | readonly (readonly (string | null)[])[]
  | readonly [number, string];

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  [
    "SELECT REGEXP_SUBSTR('a{b','{')",
    [3688, "Syntax error in regular expression on line 1, character 1."],
  ],
  [
    "SELECT REGEXP_SUBSTR('a{b','a{x}')",
    [3692, "Incorrect description of a {min,max} interval."],
  ],
  [
    "SELECT REGEXP_SUBSTR('a}b','}')",
    [3688, "Syntax error in regular expression on line 1, character 1."],
  ],
  [
    "SELECT REGEXP_SUBSTR('ab','a{1')",
    [3692, "Incorrect description of a {min,max} interval."],
  ],
  [
    "SELECT REGEXP_SUBSTR('ab','a{1,')",
    [3692, "Incorrect description of a {min,max} interval."],
  ],
  ["SELECT REGEXP_SUBSTR('aab','a{1,}')", [["aa"]]],
  ["SELECT REGEXP_SUBSTR('ab','\\\\y')", [[null]]],
  ["SELECT REGEXP_SUBSTR('ab','\\\\i')", [[null]]],
  ["SELECT REGEXP_SUBSTR('a-b','\\\\-')", [["-"]]],
  ["SELECT REGEXP_SUBSTR('a@b','\\\\@')", [["@"]]],
  ["SELECT REGEXP_SUBSTR('a b','\\\\ ')", [[" "]]],
  ["SELECT REGEXP_SUBSTR('ab','\\\\c')", [[null]]],
  ["SELECT REGEXP_SUBSTR('ab','\\\\o')", [[null]]],
  ["SELECT REGEXP_SUBSTR('ab','\\\\g')", [[null]]],
  ["SELECT REGEXP_SUBSTR('ab','\\\\q')", [[null]]],
  ["SELECT REGEXP_SUBSTR('ab','\\\\m')", [[null]]],
  ["SELECT REGEXP_SUBSTR('ab','\\\\j')", [[null]]],
  ["SELECT REGEXP_SUBSTR('ab','\\\\l')", [[null]]],
  [
    "SELECT REGEXP_SUBSTR('ab','\\\\8')",
    [3694, "Invalid back-reference in regular expression."],
  ],
  ["SELECT REGEXP_SUBSTR('aa','(a)\\\\1')", [["aa"]]],
  [
    "SELECT REGEXP_SUBSTR('aa','(a)\\\\2')",
    [3694, "Invalid back-reference in regular expression."],
  ],
  ["SELECT REGEXP_SUBSTR('aa','(a)\\\\10')", [[null]]],
  ["SELECT REGEXP_SUBSTR('aa0','(a)\\\\10')", [["aa0"]]],
  ["SELECT REGEXP_SUBSTR('ab','(?<n>a)\\\\k<n>')", [[null]]],
  ["SELECT REGEXP_SUBSTR('aa','(?<n>a)\\\\k<n>')", [["aa"]]],
  ["SELECT REGEXP_SUBSTR('aab','(?>a+)b')", [["aab"]]],
  ["SELECT REGEXP_SUBSTR('aab','(?>a+)ab')", [[null]]],
  ["SELECT REGEXP_SUBSTR('aab','a{1,2}+b')", [["aab"]]],
  ["SELECT REGEXP_SUBSTR('aab','a?+ab')", [["aab"]]],
  ["SELECT REGEXP_SUBSTR('Ab','(?i)a(?-i)b')", [["Ab"]]],
  ["SELECT REGEXP_SUBSTR('AB','(?i)a(?-i)b')", [[null]]],
  ["SELECT REGEXP_SUBSTR('AB','a(?i)b')", [["AB"]]],
  ["SELECT REGEXP_SUBSTR('AB','(?i:a)b')", [["AB"]]],
  ["SELECT REGEXP_SUBSTR('aB','(?i:a)b')", [["aB"]]],
  ["SELECT REGEXP_SUBSTR('a\\nb','(?s)a.b')", [["a\nb"]]],
  ["SELECT REGEXP_SUBSTR('a\\nb','(?m)^b')", [["b"]]],
  ["SELECT REGEXP_SUBSTR('ab','(?w)a')", [["a"]]],
  [
    "SELECT REGEXP_SUBSTR('ab','(?z)a')",
    [3688, "Syntax error in regular expression on line 1, character 3."],
  ],
  ["SELECT REGEXP_SUBSTR('ab','(?x)a # comment')", [["a"]]],
  [
    "SELECT REGEXP_SUBSTR('a b','(?x)a[ ]b')",
    [3696, "The regular expression contains an unclosed bracket expression."],
  ],
  ["SELECT REGEXP_SUBSTR('a b','(?x)a\\\\ b')", [["a b"]]],
  ["SELECT REGEXP_SUBSTR('ab','(?x: a b )')", [["ab"]]],
  ["SELECT REGEXP_SUBSTR('a\\nb','a\\\\Rb')", [["a\nb"]]],
  ["SELECT REGEXP_SUBSTR('a\\tb','a\\\\hb')", [["a\tb"]]],
  ["SELECT REGEXP_SUBSTR('a\\nb','a\\\\vb')", [["a\nb"]]],
  [
    "SELECT REGEXP_SUBSTR('a\\nb','a\\\\Nb')",
    [3685, "Illegal argument to a regular expression."],
  ],
  ["SELECT REGEXP_SUBSTR('ab','a\\\\Xb')", [[null]]],
  ["SELECT REGEXP_SUBSTR('ab','\\\\Gab')", [["ab"]]],
  ["SELECT REGEXP_SUBSTR('a\\u0007b','\\\\a')", [[null]]],
  ["SELECT REGEXP_SUBSTR('a\\u001bb','\\\\e')", [[null]]],
  ["SELECT REGEXP_SUBSTR('aAb','\\\\0101')", [["a"]]],
  [
    "SELECT REGEXP_SUBSTR('aAb','\\\\101')",
    [3694, "Invalid back-reference in regular expression."],
  ],
  ["SELECT REGEXP_SUBSTR('aAb','\\\\cA')", [[null]]],
  ["SELECT REGEXP_SUBSTR('aAb','\\\\x41')", [["a"]]],
  ["SELECT REGEXP_SUBSTR('aAb','\\\\x4')", [[null]]],
  [
    "SELECT REGEXP_SUBSTR('aAb','\\\\x{}')",
    [3689, "Unrecognized escape sequence in regular expression."],
  ],
  [
    "SELECT REGEXP_SUBSTR('aAb','\\\\x{110000}')",
    [3689, "Unrecognized escape sequence in regular expression."],
  ],
  ["SELECT REGEXP_SUBSTR('aAb','\\\\u0041')", [["a"]]],
  ["SELECT REGEXP_SUBSTR('aAb','\\\\U00000041')", [["a"]]],
  [
    "SELECT REGEXP_SUBSTR('aAb','\\\\u004')",
    [3689, "Unrecognized escape sequence in regular expression."],
  ],
  ["SELECT REGEXP_SUBSTR('aAb','\\\\p{Lu}')", [["a"]]],
  [
    "SELECT REGEXP_SUBSTR('aAb','\\\\p{Lu')",
    [3685, "Illegal argument to a regular expression."],
  ],
  [
    "SELECT REGEXP_SUBSTR('aAb','\\\\p{Bogus}')",
    [3685, "Illegal argument to a regular expression."],
  ],
  [
    "SELECT REGEXP_SUBSTR('aAb','\\\\pL')",
    [3685, "Illegal argument to a regular expression."],
  ],
  ["SELECT REGEXP_SUBSTR('aAb','[\\\\p{Lu}]')", [["a"]]],
  ["SELECT REGEXP_SUBSTR('aAb','[[:upper:]]')", [["a"]]],
  ["SELECT REGEXP_SUBSTR('aAb','[:upper:]')", [["a"]]],
  [
    "SELECT REGEXP_SUBSTR('aAb','[[:bogus:]]')",
    [3685, "Illegal argument to a regular expression."],
  ],
  ["SELECT REGEXP_SUBSTR('abc','[a-z&&[^b]]+')", [["a"]]],
  ["SELECT REGEXP_SUBSTR('abc','[a-z--[b]]+')", [["a"]]],
  ["SELECT REGEXP_SUBSTR('abc','[[a-b][c]]+')", [["abc"]]],
  ["SELECT REGEXP_SUBSTR('a-c','[a\\\\-c]+')", [["a-c"]]],
  ["SELECT REGEXP_SUBSTR('a-c','[-a]+')", [["a-"]]],
  ["SELECT REGEXP_SUBSTR('a-c','[a-]+')", [["a-"]]],
  ["SELECT REGEXP_SUBSTR('a^c','[\\\\^]+')", [["^"]]],
  ["SELECT REGEXP_SUBSTR('a^c','[^^]+')", [["a"]]],
  [
    "SELECT REGEXP_SUBSTR('a[c','[[]')",
    [3696, "The regular expression contains an unclosed bracket expression."],
  ],
  ["SELECT REGEXP_SUBSTR('a[c','[\\\\[]')", [["["]]],
  ["SELECT REGEXP_SUBSTR('a]c','[^]]+')", [["a"]]],
  ["SELECT REGEXP_SUBSTR('a]c','[]a]+')", [["a]"]]],
  [
    "SELECT REGEXP_SUBSTR('abc','[]')",
    [3696, "The regular expression contains an unclosed bracket expression."],
  ],
  [
    "SELECT REGEXP_SUBSTR('abc','[^]')",
    [3696, "The regular expression contains an unclosed bracket expression."],
  ],
  ["SELECT REGEXP_SUBSTR('a.c','[.]')", [["."]]],
  ["SELECT REGEXP_SUBSTR('abc','()')", [[""]]],
  ["SELECT REGEXP_SUBSTR('abc','a|')", [["a"]]],
  ["SELECT REGEXP_SUBSTR('abc','|')", [[""]]],
  [
    "SELECT REGEXP_SUBSTR('abc','a**')",
    [3688, "Syntax error in regular expression on line 1, character 3."],
  ],
  ["SELECT REGEXP_SUBSTR('abc','a??')", [[""]]],
  [
    "SELECT REGEXP_SUBSTR('abc','a{2}{3}')",
    [3688, "Syntax error in regular expression on line 1, character 5."],
  ],
  [
    "SELECT REGEXP_SUBSTR('abc','*a')",
    [3688, "Syntax error in regular expression on line 1, character 1."],
  ],
  [
    "SELECT REGEXP_SUBSTR('abc','(*a)')",
    [3688, "Syntax error in regular expression on line 1, character 2."],
  ],
  [
    "SELECT REGEXP_SUBSTR('abc','a|*')",
    [3688, "Syntax error in regular expression on line 1, character 3."],
  ],
  ["SELECT REGEXP_SUBSTR('abc','^*')", [[""]]],
  ["SELECT REGEXP_SUBSTR('abc','$*')", [[""]]],
  [
    "SELECT REGEXP_SUBSTR('abc','\\\\b*')",
    [3688, "Syntax error in regular expression on line 1, character 3."],
  ],
  [
    "SELECT REGEXP_SUBSTR('abc','(?=a)*')",
    [3688, "Syntax error in regular expression on line 1, character 6."],
  ],
  ["SELECT REGEXP_SUBSTR('abc','b(?<=a.)')", [["b"]]],
  [
    "SELECT REGEXP_SUBSTR('abc','(?<=a+)b')",
    [
      3695,
      "The look-behind assertion exceeds the limit in regular expression.",
    ],
  ],
  [
    "SELECT REGEXP_SUBSTR('abc','(?<=a*)b')",
    [
      3695,
      "The look-behind assertion exceeds the limit in regular expression.",
    ],
  ],
  ["SELECT REGEXP_SUBSTR('abc','(?<!z)b')", [["b"]]],
  [
    "SELECT REGEXP_SUBSTR('abc','(?')",
    [3688, "Syntax error in regular expression on line 1, character 2."],
  ],
  [
    "SELECT REGEXP_SUBSTR('abc','(?<')",
    [3688, "Syntax error in regular expression on line 1, character 3."],
  ],
  [
    "SELECT REGEXP_SUBSTR('abc','(?<1a>b)')",
    [3688, "Syntax error in regular expression on line 1, character 4."],
  ],
  [
    "SELECT REGEXP_SUBSTR('abc','(?<a>b)(?<a>c)')",
    [3887, "A capture group has an invalid name."],
  ],
  [
    "SELECT REGEXP_SUBSTR('abc','(?<a_b>b)')",
    [3887, "A capture group has an invalid name."],
  ],
  [
    "SELECT REGEXP_SUBSTR('abc','a)')",
    [3691, "Mismatched parenthesis in regular expression."],
  ],
  [
    "SELECT REGEXP_SUBSTR('abc','(a')",
    [3691, "Mismatched parenthesis in regular expression."],
  ],
  [
    "SELECT REGEXP_SUBSTR('abc','[a')",
    [3696, "The regular expression contains an unclosed bracket expression."],
  ],
  [
    "SELECT REGEXP_SUBSTR('abc','a{3,2}')",
    [3693, "The maximum is less than the minumum in a {min,max} interval."],
  ],
  [
    "SELECT REGEXP_SUBSTR('abc','a{2147483648}')",
    [4007, "Decimal number in regular expression is too large."],
  ],
  [
    "SELECT REGEXP_SUBSTR('abc','a{2147483647}')",
    [4007, "Decimal number in regular expression is too large."],
  ],
  ["SELECT REGEXP_SUBSTR('abc','a{1000000}')", [[null]]],
  ["SELECT REGEXP_SUBSTR('abc','\\\\Qb')", [["b"]]],
  ["SELECT REGEXP_SUBSTR('a\\\\Ec','\\\\E')", [["E"]]],
  ["SELECT REGEXP_SUBSTR('abc','\\\\Q\\\\E')", [[""]]],
  [
    "SELECT REGEXP_SUBSTR('abc','(?#unclosed')",
    [3691, "Mismatched parenthesis in regular expression."],
  ],
  ["SELECT REGEXP_SUBSTR('a$c','\\\\$')", [["$"]]],
  ["SELECT REGEXP_SUBSTR('abc','\\\\B.')", [["b"]]],
  ["SELECT REGEXP_SUBSTR('a1c','\\\\d')", [["1"]]],
  ["SELECT REGEXP_SUBSTR('a c','\\\\s')", [[" "]]],
  ["SELECT REGEXP_SUBSTR('a c','\\\\S+')", [["a"]]],
  ["SELECT REGEXP_SUBSTR('a c','\\\\s')", [[" "]]],
  ["SELECT REGEXP_INSTR('ab\\n','b$')", [["2"]]],
  ["SELECT REGEXP_INSTR('ab\\n\\n','b$')", [["0"]]],
  ["SELECT REGEXP_INSTR('aé','a\\\\b')", [["0"]]],
  ["SELECT REGEXP_INSTR('é a','\\\\ba')", [["3"]]],
  ["SELECT REGEXP_INSTR('éa','\\\\Ba')", [["2"]]],
  ["SELECT REGEXP_INSTR('a_b','a\\\\b')", [["0"]]],
  ["SELECT REGEXP_INSTR('a1','a\\\\b')", [["0"]]],
  ["SELECT REGEXP_INSTR('a\\u0301','a\\\\b')", [["0"]]],
  ["SELECT REGEXP_SUBSTR('aB','(?-i)ab')", [[null]]],
  ["SELECT REGEXP_SUBSTR('AB','(?-i)(?i)ab')", [["AB"]]],
  ["SELECT REGEXP_SUBSTR('aBC','a(?i)b(?-i)c')", [[null]]],
  ["SELECT REGEXP_SUBSTR('aBc','a(?i)b(?-i)c')", [["aBc"]]],
  ["SELECT REGEXP_SUBSTR('aBc','a(?i:b)c')", [["aBc"]]],
  ["SELECT REGEXP_SUBSTR('aBc' COLLATE utf8mb4_bin,'a(?i:b)c')", [["aBc"]]],
  ["SELECT REGEXP_SUBSTR('aBc' COLLATE utf8mb4_bin,'a(?i:[a-b])c')", [["aBc"]]],
  ["SELECT REGEXP_SUBSTR('aBc' COLLATE utf8mb4_bin,'a(?i)(b)\\\\1')", [[null]]],
  ["SELECT REGEXP_SUBSTR('abc' COLLATE utf8mb4_bin,'(?i)(?<x>B)')", [["b"]]],
  ["SELECT REGEXP_SUBSTR('a b','(?x)a\\\\x20b')", [["a b"]]],
  ["SELECT REGEXP_SUBSTR('ab','(?x)a#x\\nb')", [["ab"]]],
  ["SELECT REGEXP_SUBSTR('ab','(?x)a(?-x) b')", [[null]]],
  ["SELECT REGEXP_SUBSTR('ab','(?x)a { 1 } b')", [["ab"]]],
  ["SELECT REGEXP_SUBSTR('aab','(?x)a + b')", [["aab"]]],
  ["SELECT REGEXP_SUBSTR('a b','(?x)a[\\\\ ]b')", [["a b"]]],
  ["SELECT REGEXP_SUBSTR('abc','a\\\\Q\\\\Ec')", [[null]]],
  ["SELECT REGEXP_SUBSTR('a*c','a\\\\Q*\\\\E+c')", [["a*c"]]],
  ["SELECT REGEXP_SUBSTR('a**c','a\\\\Q**\\\\E+c')", [["a**c"]]],
  ["SELECT REGEXP_SUBSTR('a**c','a\\\\Q*\\\\E+c')", [["a**c"]]],
  ["SELECT REGEXP_SUBSTR('a]c','[\\\\Q]\\\\E]+')", [["]"]]],
  ["SELECT REGEXP_SUBSTR('abc','(?i)(?#x)B')", [["b"]]],
  ["SELECT REGEXP_SUBSTR('abc','a(?#x)*')", [["a"]]],
  [
    "SELECT REGEXP_SUBSTR('aaa','a*?+')",
    [3688, "Syntax error in regular expression on line 1, character 4."],
  ],
  [
    "SELECT REGEXP_SUBSTR('aaa','a+++')",
    [3688, "Syntax error in regular expression on line 1, character 4."],
  ],
  ["SELECT REGEXP_SUBSTR('aaa','a{2}+')", [["aa"]]],
  ["SELECT REGEXP_SUBSTR('aaa','a{2}?')", [["aa"]]],
  [
    "SELECT REGEXP_SUBSTR('aaa','(?<=a)*a')",
    [3688, "Syntax error in regular expression on line 1, character 7."],
  ],
  ["SELECT REGEXP_SUBSTR('aaa','(?<=a{2})a')", [["a"]]],
  ["SELECT REGEXP_SUBSTR('aaa','(?<=a{1,2})a')", [["a"]]],
  ["SELECT REGEXP_SUBSTR('aaa','(?<=(a|aa))a')", [["a"]]],
  ["SELECT REGEXP_SUBSTR('aaa','(?<=a?)a')", [["a"]]],
  [
    "SELECT REGEXP_SUBSTR('aaa','(?<=a{2,})a')",
    [
      3695,
      "The look-behind assertion exceeds the limit in regular expression.",
    ],
  ],
  [
    "SELECT REGEXP_SUBSTR('aaa','(?<=\\\\1)(a)')",
    [
      3695,
      "The look-behind assertion exceeds the limit in regular expression.",
    ],
  ],
  [
    "SELECT REGEXP_SUBSTR('aaa','(a)(?<=\\\\1)a')",
    [
      3695,
      "The look-behind assertion exceeds the limit in regular expression.",
    ],
  ],
  [
    "SELECT REGEXP_SUBSTR('aaa','(?<=a.*)a')",
    [
      3695,
      "The look-behind assertion exceeds the limit in regular expression.",
    ],
  ],
  ["SELECT REGEXP_SUBSTR('aaa','(?<=[a-z]{50})a')", [[null]]],
  [
    "SELECT REGEXP_SUBSTR('aaa','(?<=\\\\X)a')",
    [
      3695,
      "The look-behind assertion exceeds the limit in regular expression.",
    ],
  ],
  ["SELECT REGEXP_SUBSTR('aaa','(?<=\\\\R)a')", [[null]]],
  [
    "SELECT REGEXP_SUBSTR('a\\nb','\\\\N')",
    [3685, "Illegal argument to a regular expression."],
  ],
  ["SELECT REGEXP_SUBSTR('aé','\\\\X')", [["a"]]],
  ["SELECT REGEXP_SUBSTR('abc','\\\\p{L}+')", [["abc"]]],
  ["SELECT REGEXP_SUBSTR('abc','\\\\p{Letter}+')", [["abc"]]],
  ["SELECT REGEXP_SUBSTR('abc','\\\\p{IsL}+')", [["abc"]]],
  ["SELECT REGEXP_SUBSTR('abc','\\\\p{gc=L}+')", [["abc"]]],
  ["SELECT REGEXP_SUBSTR('abc','\\\\p{General_Category=Letter}+')", [["abc"]]],
  ["SELECT REGEXP_SUBSTR('abc','\\\\p{Latin}+')", [["abc"]]],
  ["SELECT REGEXP_SUBSTR('abc','\\\\p{sc=Latin}+')", [["abc"]]],
  ["SELECT REGEXP_SUBSTR('abc','\\\\p{Script=Latn}+')", [["abc"]]],
  ["SELECT REGEXP_SUBSTR('abc','\\\\p{Alphabetic}+')", [["abc"]]],
  ["SELECT REGEXP_SUBSTR('abc','\\\\p{alpha}+')", [["abc"]]],
  ["SELECT REGEXP_SUBSTR('abc','\\\\p{ALPHA}+')", [["abc"]]],
  ["SELECT REGEXP_SUBSTR('abc','\\\\p{lowercase letter}+')", [["abc"]]],
  ["SELECT REGEXP_SUBSTR('abc','\\\\p{Lowercase_Letter}+')", [["abc"]]],
  ["SELECT REGEXP_SUBSTR('abc','\\\\p{lu}+')", [["abc"]]],
  ["SELECT REGEXP_SUBSTR('abc','\\\\P{Lu}+')", [[null]]],
  [
    "SELECT REGEXP_SUBSTR('abc','\\\\p{^Lu}+')",
    [3685, "Illegal argument to a regular expression."],
  ],
  ["SELECT REGEXP_SUBSTR('abc','[\\\\P{Lu}]+')", [[null]]],
  ["SELECT REGEXP_SUBSTR('abc','\\\\p{Any}+')", [["abc"]]],
  ["SELECT REGEXP_SUBSTR('abc','\\\\p{ASCII}+')", [["abc"]]],
  ["SELECT REGEXP_SUBSTR('abc','\\\\p{Assigned}+')", [["abc"]]],
  ["SELECT REGEXP_SUBSTR('abc','\\\\p{word}+')", [["abc"]]],
  ["SELECT REGEXP_SUBSTR('abc','\\\\p{digit}+')", [[null]]],
  ["SELECT REGEXP_SUBSTR('a1c','\\\\p{digit}+')", [["1"]]],
  ["SELECT REGEXP_SUBSTR('a1c','\\\\p{xdigit}+')", [["a1c"]]],
  ["SELECT REGEXP_SUBSTR('abc','[[:word:]]+')", [["abc"]]],
  ["SELECT REGEXP_SUBSTR('a c','[[:blank:]]+')", [[" "]]],
  ["SELECT REGEXP_SUBSTR('abc','[[:^alpha:]]')", [[null]]],
  ["SELECT REGEXP_SUBSTR('a1c','[[:^alpha:]]')", [["1"]]],
  ["SELECT REGEXP_SUBSTR('abc','[a-c&&b]')", [["b"]]],
  ["SELECT REGEXP_SUBSTR('abc','[a-c&b]')", [["a"]]],
  ["SELECT REGEXP_SUBSTR('a&c','[a&c]+')", [["a&c"]]],
  ["SELECT REGEXP_SUBSTR('a&c','[&]+')", [["&"]]],
  ["SELECT REGEXP_SUBSTR('a-c','[a--c]+')", [["a"]]],
  ["SELECT REGEXP_SUBSTR('a-c','[a-c--b]+')", [["a"]]],
  ["SELECT REGEXP_SUBSTR('abc','[\\\\w&&[^b]]+')", [["a"]]],
  ["SELECT REGEXP_SUBSTR('abc','[^[b]]+')", [["a"]]],
  ["SELECT REGEXP_SUBSTR('abc','[[b]a]+')", [["ab"]]],
  [
    "SELECT REGEXP_SUBSTR('a-c','[a-\\\\w]+')",
    [3688, "Syntax error in regular expression on line 1, character 5."],
  ],
  ["SELECT REGEXP_SUBSTR('a-c','[\\\\w-a]+')", [["a-c"]]],
  ["SELECT REGEXP_SUBSTR('a-c','[\\\\w-]+')", [["a-c"]]],
  [
    "SELECT REGEXP_SUBSTR('a-c','[--a]+')",
    [3688, "Syntax error in regular expression on line 1, character 3."],
  ],
  ["SELECT REGEXP_SUBSTR('a{c','[{]+')", [["{"]]],
  ["SELECT REGEXP_SUBSTR('a$c','[$]+')", [["$"]]],
  ["SELECT REGEXP_SUBSTR('a|c','[|]+')", [["|"]]],
  ["SELECT REGEXP_SUBSTR('a(c','[(]+')", [["("]]],
  ["SELECT REGEXP_SUBSTR('a\\\\c','[\\\\\\\\]+')", [["\\"]]],
  ["SELECT REGEXP_SUBSTR('abc','[\\\\x{62}-\\\\x{63}]+')", [["bc"]]],
  ["SELECT REGEXP_SUBSTR('abc','[\\\\Qb\\\\E]+')", [["b"]]],
  [
    "SELECT REGEXP_SUBSTR('abc','[b-a]')",
    [
      3697,
      "The regular expression contains an [x-y] character range where x comes after y.",
    ],
  ],
  ["SELECT REGEXP_SUBSTR('a c','[\\\\s]+')", [[" "]]],
  ["SELECT REGEXP_SUBSTR('abc','[\\\\d]+')", [[null]]],
  ["SELECT REGEXP_SUBSTR('abc','[\\\\D]+')", [["abc"]]],
  ["SELECT REGEXP_SUBSTR('abc','[\\\\b]')", [["b"]]],
  ["SELECT REGEXP_SUBSTR('abc','[\\\\y]')", [[null]]],
  ["SELECT REGEXP_SUBSTR('abc','[\\\\p{L}--\\\\p{Lu}]+')", [[null]]],
  ["SELECT REGEXP_SUBSTR('abc','[[:L:]]+')", [["abc"]]],
  ["SELECT REGEXP_SUBSTR('abc','[[:Lu:]]+')", [["abc"]]],
  ["SELECT REGEXP_SUBSTR('abc','[[:script=Latin:]]+')", [["abc"]]],
  ["SELECT REGEXP_SUBSTR('abc','[\\\\p{L}]+')", [["abc"]]],
  ["SELECT REGEXP_SUBSTR('abc','[:L:]+')", [["abc"]]],
  ["SELECT REGEXP_SUBSTR('abc','\\\\x{0062}')", [["b"]]],
  [
    "SELECT REGEXP_SUBSTR('abc','\\\\x{00000062}')",
    [3689, "Unrecognized escape sequence in regular expression."],
  ],
  [
    "SELECT REGEXP_SUBSTR('abc','\\\\x{000000062}')",
    [3689, "Unrecognized escape sequence in regular expression."],
  ],
  [
    "SELECT REGEXP_SUBSTR('abc','\\\\xg')",
    [3689, "Unrecognized escape sequence in regular expression."],
  ],
  [
    "SELECT REGEXP_SUBSTR('abc','\\\\x')",
    [3689, "Unrecognized escape sequence in regular expression."],
  ],
  [
    "SELECT REGEXP_SUBSTR('abc','\\\\0')",
    [3689, "Unrecognized escape sequence in regular expression."],
  ],
  [
    "SELECT REGEXP_SUBSTR('abc','\\\\08')",
    [3689, "Unrecognized escape sequence in regular expression."],
  ],
  ["SELECT REGEXP_SUBSTR('abc','\\\\c')", [["c"]]],
  ["SELECT REGEXP_SUBSTR('abc','\\\\c1')", [[null]]],
  [
    "SELECT REGEXP_SUBSTR('abc','\\\\k')",
    [3887, "A capture group has an invalid name."],
  ],
  [
    "SELECT REGEXP_SUBSTR('abc','\\\\k<')",
    [3887, "A capture group has an invalid name."],
  ],
  [
    "SELECT REGEXP_SUBSTR('abc','\\\\k<x')",
    [3887, "A capture group has an invalid name."],
  ],
  [
    "SELECT REGEXP_SUBSTR('abc','\\\\k<x>(?<x>a)')",
    [3887, "A capture group has an invalid name."],
  ],
  ["SELECT REGEXP_SUBSTR('abc','(a)|\\\\1b')", [["a"]]],
  [
    "SELECT REGEXP_SUBSTR('a}b','a}')",
    [3688, "Syntax error in regular expression on line 1, character 2."],
  ],
  ["SELECT REGEXP_SUBSTR('a]b','a]')", [["a]"]]],
  ["SELECT REGEXP_SUBSTR('a]b',']')", [["]"]]],
  [
    "SELECT REGEXP_SUBSTR('a}b','a{1}}')",
    [3688, "Syntax error in regular expression on line 1, character 5."],
  ],
  [
    "SELECT REGEXP_SUBSTR('ab','a{1,2,3}')",
    [3692, "Incorrect description of a {min,max} interval."],
  ],
  [
    "SELECT REGEXP_SUBSTR('ab','a{ 1}')",
    [3692, "Incorrect description of a {min,max} interval."],
  ],
  [
    "SELECT REGEXP_SUBSTR('ab','a{1 }')",
    [3692, "Incorrect description of a {min,max} interval."],
  ],
  [
    "SELECT REGEXP_SUBSTR('ab','(?i')",
    [3900, "Invalid match mode flag in regular expression."],
  ],
  [
    "SELECT REGEXP_SUBSTR('ab','(?i-')",
    [3900, "Invalid match mode flag in regular expression."],
  ],
  ["SELECT REGEXP_SUBSTR('ab','(?-)a')", [["a"]]],
  [
    "SELECT REGEXP_SUBSTR('ab','(?)a')",
    [3688, "Syntax error in regular expression on line 1, character 3."],
  ],
  ["SELECT REGEXP_SUBSTR('ab','(?i)')", [[""]]],
  [
    "SELECT REGEXP_SUBSTR('ab','(?:')",
    [3691, "Mismatched parenthesis in regular expression."],
  ],
  [
    "SELECT REGEXP_SUBSTR('ab','(?!a')",
    [3691, "Mismatched parenthesis in regular expression."],
  ],
  [
    "SELECT REGEXP_SUBSTR('ab',')(')",
    [3691, "Mismatched parenthesis in regular expression."],
  ],
  [
    "SELECT REGEXP_SUBSTR('ab','(?<n>')",
    [3691, "Mismatched parenthesis in regular expression."],
  ],
  [
    "SELECT REGEXP_SUBSTR('ab','[a-z')",
    [3696, "The regular expression contains an unclosed bracket expression."],
  ],
  ["SELECT REGEXP_SUBSTR('ab','a{0}b')", [["b"]]],
  [
    "SELECT REGEXP_SUBSTR('ab','(?<n>a)\\\\k<m>')",
    [3887, "A capture group has an invalid name."],
  ],
  ["SELECT REGEXP_SUBSTR('ab','\\\\Q')", [[""]]],
  [
    "SELECT REGEXP_SUBSTR('ab','[[:alpha:]')",
    [3696, "The regular expression contains an unclosed bracket expression."],
  ],
  ["SELECT REGEXP_SUBSTR('ab','[[:alpha]]')", [["a"]]],
  ["SELECT REGEXP_SUBSTR('ab','[[:]]')", [[null]]],
  [
    "SELECT REGEXP_SUBSTR('ab','[\\\\p{L}')",
    [3696, "The regular expression contains an unclosed bracket expression."],
  ],
  [
    "SELECT REGEXP_SUBSTR('ab','[\\\\x{62}-\\\\x{61}]')",
    [
      3697,
      "The regular expression contains an [x-y] character range where x comes after y.",
    ],
  ],
  ["SELECT REGEXP_SUBSTR('ab','[a-\\\\x{62}]+')", [["ab"]]],
  [
    "SELECT REGEXP_SUBSTR('ab','a\\n**')",
    [3688, "Syntax error in regular expression on line 2, character 2."],
  ],
  [
    "SELECT REGEXP_SUBSTR('ab','a\\n\\nb**')",
    [3688, "Syntax error in regular expression on line 3, character 3."],
  ],
  ["SELECT REGEXP_SUBSTR('ab','\\\\x{10FFFF}')", [[null]]],
  ["SELECT REGEXP_SUBSTR('ab','\\\\x{000062}')", [["b"]]],
  ["SELECT REGEXP_SUBSTR('ab','\\\\x{0000062}')", [["b"]]],
  ["SELECT REGEXP_SUBSTR('ab','\\\\o{142}')", [[null]]],
  [
    "SELECT REGEXP_SUBSTR('ab','\\\\u{62}')",
    [3689, "Unrecognized escape sequence in regular expression."],
  ],
  ["SELECT REGEXP_SUBSTR('ab','\\\\uD800')", [[null]]],
  ["SELECT REGEXP_SUBSTR('ab','\\\\x{D800}')", [[null]]],
  [
    "SELECT REGEXP_SUBSTR('ab','a{100000000}')",
    [4007, "Decimal number in regular expression is too large."],
  ],
  ["SELECT REGEXP_SUBSTR('ab','a{10000000}')", [[null]]],
  ["SELECT REGEXP_SUBSTR('ab','a{16777215}')", [[null]]],
  [
    "SELECT REGEXP_SUBSTR('ab','a{16777216}')",
    [4007, "Decimal number in regular expression is too large."],
  ],
  [
    "SELECT REGEXP_SUBSTR('ab','a{0,16777216}')",
    [4007, "Decimal number in regular expression is too large."],
  ],
  [
    "SELECT REGEXP_SUBSTR('ab','a{0,99999999999}')",
    [4007, "Decimal number in regular expression is too large."],
  ],
  [
    "SELECT REGEXP_SUBSTR('ab','(a)\\\\99999999999')",
    [3694, "Invalid back-reference in regular expression."],
  ],
  [
    "SELECT REGEXP_SUBSTR('ab','\\\\1a')",
    [3694, "Invalid back-reference in regular expression."],
  ],
  ["SELECT REGEXP_SUBSTR('ab','a(?<x>b)\\\\k<x>')", [[null]]],
  ["SELECT REGEXP_SUBSTR('ab','(?<x>a)(?<y>b)')", [["ab"]]],
  ["SELECT REGEXP_REPLACE('ab','(?<x>a)(?<y>b)','${y}${x}')", [["ba"]]],
  [
    "SELECT REGEXP_REPLACE('ab','(?<x>a)(?<y>b)','${z}')",
    [3887, "A capture group has an invalid name."],
  ],
  [
    "SELECT REGEXP_REPLACE('ab','(?<x>a)(?<y>b)','${1}')",
    [3887, "A capture group has an invalid name."],
  ],
  [
    "SELECT REGEXP_REPLACE('ab','(?<x>a)(?<y>b)','${y')",
    [3887, "A capture group has an invalid name."],
  ],
  [
    "SELECT REGEXP_REPLACE('ab','(?<x>a)(?<y>b)','${}')",
    [3887, "A capture group has an invalid name."],
  ],
  ["SELECT REGEXP_REPLACE('ab','(?<x>a)(?<y>b)','$0$0')", [["abab"]]],
  ["SELECT REGEXP_REPLACE('ab','(?<x>a)(?<y>b)','$00')", [["ab"]]],
  [
    "SELECT REGEXP_REPLACE('ab','(?<x>a)(?<y>b)','$')",
    [3887, "A capture group has an invalid name."],
  ],
  [
    "SELECT REGEXP_REPLACE('ab','(?<x>a)(?<y>b)','$x')",
    [3887, "A capture group has an invalid name."],
  ],
  ["SELECT REGEXP_REPLACE('ab','(?<x>a)(?<y>b)','\\\\$1')", [["$1"]]],
  ["SELECT REGEXP_REPLACE('ab','(?<x>a)(?<y>b)','\\\\u00')", [["u00"]]],
  ["SELECT REGEXP_REPLACE('ab','(?<x>a)(?<y>b)','\\\\u00zz')", [["u00zz"]]],
  ["SELECT REGEXP_REPLACE('ab','(?<x>a)(?<y>b)','\\\\x41')", [["x41"]]],
  ["SELECT REGEXP_REPLACE('ab','(?<x>a)(?<y>b)','\\\\n')", [["n"]]],
  ["SELECT REGEXP_REPLACE('ab','(?<x>a)(?<y>b)','\\\\U0010FFFF')", [["􏿿"]]],
  [
    "SELECT REGEXP_REPLACE('ab','(?<x>a)(?<y>b)','\\\\U00110000')",
    [["U00110000"]],
  ],
  ["SELECT REGEXP_REPLACE('ab','(a)|(b)','[$2]')", [["[][b]"]]],
  ["SELECT REGEXP_REPLACE('ab','(?>a)','x')", [["xb"]]],
  ["SELECT REGEXP_REPLACE('ab','(?>(a))','<$1>')", [["<a>b"]]],
  ["SELECT REGEXP_REPLACE('aab','(a)++(b)','<$1$2>')", [["<ab>"]]],
  [
    "SELECT REGEXP_REPLACE('aab','(a)++(b)','<$3>')",
    [3686, "Index out of bounds in regular expression search."],
  ],
  ["SELECT REGEXP_SUBSTR('ab','(?w)\\\\bb')", [[null]]],
  ["SELECT REGEXP_SUBSTR('ab','(?d)a')", [["a"]]],
  ["SELECT REGEXP_SUBSTR('ab','(?u)a')", [["a"]]],
  ["SELECT REGEXP_SUBSTR('ab','(?ismwx)a')", [["a"]]],
  [
    "SELECT REGEXP_SUBSTR('ab','(?I)a')",
    [3688, "Syntax error in regular expression on line 1, character 3."],
  ],
];

test("M5.10: every ICU pattern is read, refused or matched as 8.4.11 did", async () => {
  const db = await MySQL.open(":memory:");
  const conn = await mysql.createConnection({
    stream: db.createStream() as never,
    user: "root",
    password: "",
  });
  try {
    for (const [sql, expected] of SCRIPT) {
      let actual: Outcome;
      try {
        const [r] = await conn.query({ sql, rowsAsArray: true });
        actual = (r as unknown[][]).map((row) =>
          row.map((v) => (v === null ? null : String(v))),
        );
      } catch (e) {
        const err = e as { errno: number; message: string };
        actual = [err.errno, err.message];
      }
      assert.deepEqual(actual, expected, sql);
    }
  } finally {
    await conn.end();
    await db.end();
  }
});
