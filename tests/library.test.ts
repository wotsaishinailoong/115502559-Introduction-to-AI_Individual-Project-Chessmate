import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { analyzeGame, type Evaluation } from '../lib/analysis.ts';
import { addPractice, backupLibrary, emptyLibrary, importLibrary, LIBRARY_KEY, loadLibrary, mergeLibraries, needsPractice, parseLibrary, persistLibrary, practiceItems, recordPractice, removeAnalysis, saveAnalysis, serializeLibrary, upsertAnalysis } from '../lib/library.ts';
class MemoryStorage {
  data = new Map<string,string>(); quota = false;
  getItem(key:string){return this.data.get(key)??null;}
  setItem(key:string,value:string){if(this.quota)throw new Error('QuotaExceededError');this.data.set(key,value);}
}
async function fixture(player:'w'|'b'='w',round=1){
  const board=new Chess(new Chess().fen().replace(/ 1$/,` ${round}`));for(const m of ['f3','e5','g4','Qh4#'])board.move(m);
  const pgn=board.pgn();
  const report=await analyzeGame(pgn,player,async(position,turn,nodes,move):Promise<Evaluation>=>{
    const i=position.split(' moves ')[1]?.split(' ').length??0;
    return {score:i===3||i===2&&move?{kind:'mate',winner:'b',moves:1}:{kind:'cp',value:0},depth:8,pv:move?[move,...(i===2?['d8h4']:[])]:[['e2e4'],['e7e5'],['g2g3'],['d8h4']][i]};
  },()=>{});
  return {pgn,report};
}

test('compact backups restore legal PGN positions, chart and lesson data',async()=>{
 const {pgn,report}=await fixture(); const saved=upsertAnalysis(emptyLibrary(),pgn,report,1000);
 const text=serializeLibrary(saved.library);assert.ok(!text.includes('position fen'));
 const restored=parseLibrary(text);assert.deepEqual(restored.entries[0].report,report);
 assert.equal(practiceItems(restored).length,1);assert.equal(practiceItems(restored)[0].theme,'國王安全與將軍');
});
test('reanalysis deduplicates metadata changes and keeps progress; the opposite color is a separate report',async()=>{
 const {pgn,report}=await fixture(); let first=upsertAnalysis(emptyLibrary(),pgn,report,1000);
 const practiced=addPractice(first.library,first.entry.id,3,true,true,2000);
 const second=upsertAnalysis(practiced,pgn.replace('[Event "?"]','[Event "Changed"]'),report,3000);
 assert.equal(second.entry.id,first.entry.id);assert.equal(second.entry.createdAt,1000);assert.equal(second.entry.practice['3'].independentSuccesses,1);assert.equal(second.library.entries.length,1);
 const black=await fixture('b');const both=upsertAnalysis(second.library,black.pgn,black.report,4000);
 assert.equal(both.library.entries.length,2);
});
test('failed, assisted and independent attempts are counted separately and cached copies cannot mutate stored data',async()=>{
 const storage=new MemoryStorage();const {pgn,report}=await fixture();const saved=saveAnalysis(pgn,report,storage);
 recordPractice(saved.id,3,false,true,storage);recordPractice(saved.id,3,true,false,storage);recordPractice(saved.id,3,true,true,storage);
 const loaded=loadLibrary(storage);assert.deepEqual([loaded.entries[0].practice['3'].attempts,loaded.entries[0].practice['3'].successes,loaded.entries[0].practice['3'].independentSuccesses],[3,2,1]);
 loaded.entries[0].report.positions[2].san='modified';assert.equal(loadLibrary(storage).entries[0].report.positions[2].san,'g4');
 assert.throws(()=>recordPractice(saved.id,2,true,true,storage),/找不到/);
});
test('malformed saved data and invalid imports never overwrite existing data; original bytes remain exportable',async()=>{
 const storage=new MemoryStorage();const f=await fixture();saveAnalysis(f.pgn,f.report,storage);
 const original=backupLibrary(storage);
 assert.throws(()=>importLibrary('{not json}',storage));assert.equal(backupLibrary(storage),original);
 const damaged=JSON.parse(original);damaged.entries[0].analysis[2].played.pv=['g2g4','d8d1'];
 assert.throws(()=>importLibrary(JSON.stringify(damaged),storage));assert.equal(backupLibrary(storage),original);
 storage.setItem(LIBRARY_KEY,'{"version":9,"entries":[]}');
 assert.throws(()=>loadLibrary(storage),/版本/);assert.throws(()=>saveAnalysis(f.pgn,f.report,storage));assert.equal(backupLibrary(storage),'{"version":9,"entries":[]}');
});
test('quota failures leave the original analysis and progress intact',async()=>{
 const storage=new MemoryStorage();const f=await fixture();const saved=saveAnalysis(f.pgn,f.report,storage);const before=backupLibrary(storage);storage.quota=true;
 assert.throws(()=>recordPractice(saved.id,3,true,true,storage),/尚未保存/);
 assert.equal(backupLibrary(storage),before);assert.equal(loadLibrary(storage).entries[0].practice['3'],undefined);
});
test('repeated backup imports are idempotent and merge forked progress without adding duplicate counts',async()=>{
 const f=await fixture();const base=upsertAnalysis(emptyLibrary(),f.pgn,f.report,1000);
 const a=addPractice(addPractice(base.library,base.entry.id,3,true,true,2000),base.entry.id,3,false,true,3000);
 const b=addPractice(addPractice(addPractice(base.library,base.entry.id,3,false,true,4000),base.entry.id,3,false,true,5000),base.entry.id,3,false,true,6000);
 const merged=mergeLibraries(a,b);assert.deepEqual([merged.entries[0].practice['3'].attempts,merged.entries[0].practice['3'].successes,merged.entries[0].practice['3'].independentSuccesses],[3,1,1]);
 assert.deepEqual(mergeLibraries(merged,b),merged);
 const storage=new MemoryStorage();persistLibrary(merged,storage);importLibrary(serializeLibrary(merged),storage);assert.equal(loadLibrary(storage).entries.length,1);
});
test('deletion removes only the chosen report and never the active chess game',async()=>{
 const storage=new MemoryStorage();const a=await fixture();const first=saveAnalysis(a.pgn,a.report,storage);const b=await fixture('b');const second=saveAnalysis(b.pgn,b.report,storage);
 storage.setItem('chessmate.game.v1','keep my active game');const result=removeAnalysis(second.id,storage);
 assert.equal(result.entries.length,1);assert.equal(result.activeId,first.id);assert.equal(storage.getItem('chessmate.game.v1'),'keep my active game');
});
test('report limits are explicit and preserve existing reports; ID collisions in distinct imported games are repaired',async()=>{
 let library=emptyLibrary();for(let i=1;i<=20;i++){const f=await fixture('w',i);library=upsertAnalysis(library,f.pgn,f.report,1000+i).library;}
 const extra=await fixture('w',21);assert.throws(()=>upsertAnalysis(library,extra.pgn,extra.report,3000),/20/);assert.equal(library.entries.length,20);
 const first=library.entries[0];const incoming=upsertAnalysis(emptyLibrary(),extra.pgn,extra.report,4000,first.id).library;
 const small={...library,entries:[first],activeId:first.id};const merged=mergeLibraries(small,incoming);assert.equal(merged.entries.length,2);assert.equal(new Set(merged.entries.map(e=>e.id)).size,2);
 assert.throws(()=>parseLibrary('x'.repeat(2_000_001)),/太大/);
});

test('a failed attempt after a previous independent success returns the position to the review queue',async()=>{
 const f=await fixture();const first=upsertAnalysis(emptyLibrary(),f.pgn,f.report,1000);
 const success=addPractice(first.library,first.entry.id,3,true,true,2000);
 assert.equal(needsPractice(practiceItems(success)[0].progress),false);
 const failed=addPractice(success,first.entry.id,3,false,false,3000);
 assert.equal(needsPractice(practiceItems(failed)[0].progress),true);
 assert.equal(practiceItems(failed)[0].progress.independentSuccesses,1);
});
