// Make a new admin password hash:  node hash.js "your new password"
const c = require('crypto'), pw = process.argv[2];
if (!pw) { console.log('Usage: node hash.js "your password"'); process.exit(1); }
const salt = c.randomBytes(16).toString('hex');
console.log(salt + ':' + c.scryptSync(pw, salt, 32).toString('hex'));
