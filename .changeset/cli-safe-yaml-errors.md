---
"paymentchaos": patch
---

YAML syntax, alias and unknown-key errors now report `file:line:col`, the parser error code and a fix hint without quoting the source line or key, so a value pasted into a config or scenario file never reaches stderr. Unresolved aliases and alias bombs now exit with the config error code instead of an internal error.
