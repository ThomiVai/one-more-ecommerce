import {start} from '../tests/runtime-v160.mjs';
const runtime=await start();
console.log('ONE MORE V167 · prueba local con datos ficticios, en memoria.');
console.log(runtime.url+'/?partner=COACH-QA#suplementos');
console.log(runtime.url+'/admin-v118.html#partners');
console.log('Usuario de prueba: qa-admin / clave: solo-qa-local');
console.log('Creá un partner ficticio y su acuerdo para probar el código COACH-QA. No hay código de demo precargado.');
console.log('No envíes mensajes desde los enlaces externos. Ctrl+C cierra y descarta solo estos datos ficticios.');
process.once('SIGINT',async()=>{await runtime.close();process.exit(0)});
