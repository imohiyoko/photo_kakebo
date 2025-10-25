const crypto = require('crypto');
function anonymizeUser(raw){ if(!raw) return null; return crypto.createHash('sha256').update(String(raw)).digest('hex').slice(0,16); }
function diffEntryFields(original, edited){ const diffs=[]; const fields=new Set([...Object.keys(original), ...Object.keys(edited)]); fields.forEach(f=>{ const oldVal=original[f]; const newVal=edited[f]; if(oldVal===newVal) return; let editType='replace'; if((oldVal==null||oldVal==='')&&(newVal!=null&&newVal!=='')) editType='add'; if((oldVal!=null&&oldVal!=='')&&(newVal==null||newVal==='')) editType='delete'; diffs.push({ field_name:f, old_value: oldVal, new_value:newVal, edit_type:editType }); }); return diffs; }
module.exports={ anonymizeUser, diffEntryFields };
