# Cairo font

RIVO ships the Cairo typeface for Arabic and Latin text. Cairo renders Arabic
well at UI sizes and carries a complete Latin set, so one family serves both
scripts without a visible switch mid-sentence.

## Licence

Cairo is licensed under the SIL Open Font License 1.1 (`OFL.txt`), which permits
redistribution inside an application. The licence file must stay alongside the
fonts, and the OFL requires it to be included in any redistribution.

## Provenance

The four weights here were generated from the upstream Google Fonts variable
font `Cairo[slnt,wght].ttf` by pinning the `wght` axis to 400/500/600/700 and the
`slnt` axis to 0.

Static instances rather than the variable font: variable-axis support differs
across Android and iOS engine versions, and a weight that silently falls back to
synthetic bolding looks wrong in Arabic. Four pinned files render identically
everywhere for ~660 KB total.

To regenerate:

```bash
pip install fonttools
curl -fsSL "https://raw.githubusercontent.com/google/fonts/main/ofl/cairo/Cairo%5Bslnt%2Cwght%5D.ttf" -o Cairo-var.ttf
python - <<'PY'
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
for name, wght in {"Regular": 400, "Medium": 500, "SemiBold": 600, "Bold": 700}.items():
    font = TTFont("Cairo-var.ttf")
    instantiateVariableFont(font, {"wght": wght, "slnt": 0}, inplace=True, updateFontNames=True)
    font.save(f"Cairo-{name}.ttf")
PY
rm Cairo-var.ttf
```
