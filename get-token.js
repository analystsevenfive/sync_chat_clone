/**
 * get-token.js
 * สคริปต์สำหรับกดดึง Chatcone Token ใหม่ด้วยตนเอง หรือตรวจสอบสถานะ Token
 * รันด้วย: node get-token.js
 */

const { fetchChatconeToken, isTokenValid, getCachedToken } = require('./auth-helper');

async function main() {
  console.log('==================================================');
  console.log('🔑 Chatcone Auto-Token Generator');
  console.log('==================================================\n');

  const cached = getCachedToken();
  if (cached) {
    console.log('📌 พบ Token ปัจจุบันที่บันทึกไว้ในแคช (.chatcone_token):');
    try {
      const parts = cached.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      console.log(`   User ID: ${payload.user_id}`);
      console.log(`   หมดอายุ: ${new Date(payload.exp * 1000).toLocaleString('th-TH')}`);
      console.log(`   สถานะ: ${isTokenValid(cached) ? '✅ ยังใช้งานได้' : '❌ หมดอายุแล้ว'}\n`);
    } catch (e) {}
  }

  const force = process.argv.includes('--force') || !cached || !isTokenValid(cached);

  if (!force) {
    console.log('Token ปัจจุบันยังไม่หมดอายุ หากต้องการบังคับดึงใหม่ ให้ใส่ --force:');
    console.log('   node get-token.js --force\n');
    console.log('Token ปัจจุบัน:');
    console.log(cached);
    return;
  }

  try {
    const newToken = await fetchChatconeToken();
    console.log('\n==================================================');
    console.log('🎉 ดึง Token ใหม่สำเร็จ:');
    console.log(newToken);
    console.log('==================================================\n');

    try {
      const parts = newToken.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      console.log(`User ID: ${payload.user_id}`);
      console.log(`หมดอายุ: ${new Date(payload.exp * 1000).toLocaleString('th-TH')}`);
    } catch (e) {}
  } catch (err) {
    console.error('❌ เกิดข้อผิดพลาดในการดึง Token:', err.message);
    process.exit(1);
  }
}

main();
