"""Verify synthetic joint PDFs and the browser's frozen-version ZIP; native Word pages remain manual.
P2_OUT=<root>/exports npx vitest run tests/jointExportV113.test.ts
P2_ROOT=<root> python3 tests/e2e/joint_v113_e2e.py
P2_ROOT=<root> python3 tests/e2e/verify_joint_exports.py
"""
from pathlib import Path
import fitz, zipfile, json, os
root=Path(os.environ.get('P2_ROOT','/workspace/scratch/v113-p2')); report=[]
for path in (root/'exports').glob('*.pdf'):
 doc=fitz.open(path); text='\n'.join(page.get_text() for page in doc)
 assert len(doc)==1,(path,len(doc)); assert 'MOCK-UG-GRADE' not in text and 'example.com/resume-tool' not in text
 if '_EN' in path.name: assert 'Marine Engineering' in text
 for i,page in enumerate(doc):
  assert len(page.get_text().strip())>100 and '\ufffd' not in page.get_text()
  for block in page.get_text('blocks'): assert block[0]>=-.1 and block[1]>=-.1 and block[2]<=page.rect.width+.1 and block[3]<=page.rect.height+.1,(path,block[:4])
  page.get_pixmap(matrix=fitz.Matrix(1.2,1.2)).save(str(path.with_suffix('.png')))
 report.append({'name':path.name,'pages':len(doc),'characters':len(text),'blank':False,'outside':False,'hiddenGrades':True})
assert len(report)==2,'Expected CN and EN common resume PDF'
with zipfile.ZipFile(root/'shared-version-browser.zip') as z:
 assert len([n for n in z.namelist() if n.endswith('.pdf')])==2
 assert len([n for n in z.namelist() if n.endswith('.docx')])==2
 assert len(json.loads(z.read('evidence-and-gaps.json'))['targets'])==3
 for name in z.namelist():
  if name.endswith('.pdf'):
   doc=fitz.open(stream=z.read(name),filetype='pdf'); assert len(doc)==1 and 'MOCK-UG-GRADE' not in '\n'.join(p.get_text() for p in doc)
  if name.endswith('.docx'):
   import io
   with zipfile.ZipFile(io.BytesIO(z.read(name))) as word: assert 'MOCK-UG-GRADE' not in word.read('word/document.xml').decode()
(root/'joint-pdf-verification.json').write_text(json.dumps(report,indent=2));print('Joint CN/EN PDF text/pages/nonblank/limits and browser canonical-version ZIP verified. Native Word pagination pending.')
