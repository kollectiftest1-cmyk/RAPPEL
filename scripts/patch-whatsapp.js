// Compatibility workaround for WhatsApp Web's MsgKey property rename.
// Idempotent: safe to run on install; makes no changes if already patched.
const fs = require('fs');
const path = require('path');
const target = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js', 'src', 'util', 'Injected', 'Utils.js');
if (!fs.existsSync(target)) {
  console.warn('Utils.js introuvable; correctif WhatsApp ignoré.');
  process.exit(0);
}
let content = fs.readFileSync(target, 'utf8');
const replacements = [
  ['.Msg.get(newMsgKey._serialized);', '.Msg.get(newMsgKey._serialized ?? newMsgKey.$1);'],
  ["window.require('WAWebCollections').Msg.get(msg.id._serialized);", "window.require('WAWebCollections').Msg.get(msg.id._serialized ?? msg.id.$1);"],
  ['Msg.get(chat.lastReceivedKey._serialized)', 'Msg.get(chat.lastReceivedKey._serialized ?? chat.lastReceivedKey.$1)'],
  ['chat.lastReceivedKey._serialized,', 'chat.lastReceivedKey._serialized ?? chat.lastReceivedKey.$1,']
];
let changed = false;
for (const [oldText, newText] of replacements) {
  if (content.includes(oldText)) {
    content = content.replaceAll(oldText, newText);
    changed = true;
  }
}
fs.writeFileSync(target, content, 'utf8');
console.log(changed ? 'Correctif de compatibilité WhatsApp appliqué.' : 'Correctif déjà appliqué ou non nécessaire.');
