import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function verifyBackup(file,{requireFinance=false}={}){
 const bytes=readFileSync(file);if(!bytes.length)throw Error('Respaldo vacío.');
 const directory=mkdtempSync(join(tmpdir(),'one-more-restore-'));let db;
 try{db=new DatabaseSync(join(directory,'restored.sqlite'));db.exec('PRAGMA foreign_keys=OFF');db.exec(bytes.toString('utf8'));db.exec('PRAGMA foreign_keys=ON');const check=db.prepare('PRAGMA integrity_check').all();if(check.some(r=>r.integrity_check!=='ok'))throw Error('Falló integrity_check.');const foreign=db.prepare('PRAGMA foreign_key_check').all();if(foreign.length)throw Error('El respaldo tiene referencias incompletas.');
 const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name),required=['stock_items','stock_movements','purchase_documents','purchase_lines','sales','sale_lines','catalog_stock_links','sale_returns','purchase_returns','settlements','return_reversals','sale_combo_groups'];for(const name of required)if(!names.includes(name))throw Error('Falta la tabla '+name+'. Actualizá V138 antes de activar este respaldo.');if(requireFinance||names.includes('finance_revision'))for(const name of ['finance_revision','cash_opening','cash_entries','cash_reversals','document_reviews'])if(!names.includes(name))throw Error('Falta la tabla financiera '+name+'.');const counts={};for(const name of names){if(name.startsWith('_cf'))continue;counts[name]=db.prepare('SELECT COUNT(*) n FROM "'+name.replaceAll('"','""')+'"').get().n}
 // Ejecutar vistas verifica también sus dependencias, no solo la integridad física.
 db.prepare('SELECT COUNT(*) n FROM settlement_balances_v137').get();db.prepare('SELECT COUNT(*) n FROM sales_activity_v135').get();if(names.includes('finance_revision')){db.prepare('SELECT COUNT(*) n FROM cash_flows_v139').get();db.prepare('SELECT COUNT(*) n FROM expense_activity_v139').get();db.prepare('SELECT COUNT(*) n FROM reconciliation_v139').get()}
 const imagePaths=[...new Set([...db.prepare("SELECT image_url FROM catalog_overrides WHERE image_url<>''").all(),...db.prepare("SELECT image_url FROM catalog_new_products WHERE image_url<>''").all()].map(r=>r.image_url))];return {verified:true,sha256:sha256(bytes),bytes:bytes.length,counts,stock:db.prepare('SELECT COALESCE(SUM(quantity),0) units,COALESCE(SUM(quantity*cost_cents),0) value_cents FROM stock_items').get(),imagePaths};
 }finally{db?.close();rmSync(directory,{recursive:true,force:true})}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{console.log(JSON.stringify(verifyBackup(resolve(process.argv[2])),null,2))}catch(e){console.error(e.message);process.exitCode=1}}
