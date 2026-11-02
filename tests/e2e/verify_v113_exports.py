"""Inspect actual synthetic PDFs and Word XML. Requires PyMuPDF; no Word visual-page claim.
Generate first: V113_OUT=<root>/samples V112_LAYOUT_OUT=<root>/layout npm test
Run: V113_VERIFY_ROOT=<root> python3 tests/e2e/verify_v113_exports.py
"""
import json, os, zipfile
from pathlib import Path
import fitz
ROOT=Path(os.environ.get('V113_VERIFY_ROOT','/workspace/scratch/v113-validation'))
report=[]
files=list((ROOT/'samples').glob('*.pdf'))+list((ROOT/'layout').glob('*.pdf'))
assert len(files)==10,'Generate the 4 course + 6 size/language fixtures first'
for path in sorted(files):
 doc=fitz.open(path);text='\n'.join(page.get_text() for page in doc);pages=[]
 word=path.with_suffix('.docx')
 with zipfile.ZipFile(word) as z: xml=z.read('word/document.xml').decode()
 for n,page in enumerate(doc):
  blocks=page.get_text('blocks');outside=[b[:4] for b in blocks if b[0]<-0.1 or b[1]<-0.1 or b[2]>page.rect.width+.1 or b[3]>page.rect.height+.1]
  assert len(page.get_text().strip())>50,(path,n,'blank page')
  assert not outside,(path,n,outside)
  assert '\ufffd' not in page.get_text(),path
  pages.append({'characters':len(page.get_text().strip()),'outside':len(outside)})
 if path.parent.name=='samples':
  assert len(doc)==1,path
  for content in [text,xml]:
   assert 'MOCK-UG-GRADE-2' not in content and 'MOCK-PG-GRADE' not in content and 'GPA 3.6' not in content,path
   assert ('MOCK-UG-GRADE-1' in content)==path.name.startswith('explicit'),path
   assert 'example.com/resume-tool' not in content,path
   if path.stem.endswith('en'): assert 'Marine Engineering' in content,path
 else: assert len(doc)==(2 if path.name.startswith('rich') else 1),path
 report.append({'file':str(path.relative_to(ROOT)),'pages':len(doc),'checks':pages,'word':'XML/content verified; native visual pagination pending'})
 for n,page in enumerate(doc): page.get_pixmap(matrix=fitz.Matrix(1,1)).save(str(path.with_name(path.stem+f'-page{n+1}.png')))
(ROOT/'pdf-verification.json').write_text(json.dumps(report,indent=2))
print(f'{len(report)} actual PDFs: expected pages, nonblank, text within page, grade consent; {len(report)} DOCX XML checked. Native Word pagination pending.')
