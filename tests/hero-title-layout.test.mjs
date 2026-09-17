import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'src/components/HeroBanner.tsx'), 'utf8');

test('데스크톱 Hero 제목은 좁은 좌측 컬럼에서도 문장 중간이 한 글자씩 밀리지 않는다', () => {
  assert.match(source, /lg:text-\[2rem\]/);
  assert.match(source, /xl:text-\[2\.7rem\]/);
  assert.doesNotMatch(source, /xl:text-\[3\.4rem\]/);
});
