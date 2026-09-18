import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAttachments,formatBytes } from '../apps/poc/public/composer.js';
test('attachment admission rejects invalid batches without mutating existing files',()=>{
 const existing=[{name:'kept.txt',data:'eA=='}];
 assert.throws(()=>validateAttachments(existing,[{name:'ok.txt',size:1},{name:'kept.txt',size:1}]),/already exists/);
 assert.deepEqual(existing,[{name:'kept.txt',data:'eA=='}]);
 for(const name of ['../secret','/tmp/file','.hidden','x/y','💾.txt','a'.repeat(121)])assert.throws(()=>validateAttachments([],[{name,size:1}]),/filenames/);
 assert.throws(()=>validateAttachments([],Array.from({length:6},(_,i)=>({name:'f'+i,size:1}))),/five/);
 assert.throws(()=>validateAttachments([],[{name:'big',size:2*1024*1024+1}]),/2 MB/);
 assert.throws(()=>validateAttachments([],Array.from({length:3},(_,i)=>({name:'f'+i,size:2*1024*1024}))),/total/);
 validateAttachments(existing,[{name:'New file.csv',size:2*1024*1024}]);
});
test('file sizes describe empty and small outputs accurately',()=>{
 assert.equal(formatBytes(0),'0 B');assert.equal(formatBytes(24),'24 B');assert.equal(formatBytes(1024),'1.0 KB');assert.equal(formatBytes(2*1024*1024),'2.0 MB');
});
