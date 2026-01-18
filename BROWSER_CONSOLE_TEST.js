// Quick Testing Script for Professor Registration Check
// Copy and paste this into browser console (F12) when logged in as professor

console.log('=== Professor Registration Check Test ===\n');

// Test 1: Get current user ID
console.log('Step 1: Getting user ID from auth context...');
const userIdTest = document.cookie.split(';').find(c => c.includes('auth'));
console.log('Auth cookie found:', !!userIdTest);

// Test 2: Manual API call to check registration
async function testRegistrationCheck(professorId) {
  console.log('\nStep 2: Testing registration check API...');
  console.log('Professor ID:', professorId);
  
  try {
    const response = await fetch(`/api/professor/face-registration/check?professorId=${professorId}`);
    const data = await response.json();
    
    console.log('API Response:', data);
    console.log('✅ Is Registered:', data.isRegistered);
    
    if (data.registration) {
      console.log('Registration Details:');
      console.log('  - Name:', data.registration.first_name, data.registration.last_name);
      console.log('  - Active:', data.registration.is_active);
      console.log('  - Image URL:', data.registration.image_url);
    }
    
    return data;
  } catch (error) {
    console.error('❌ Error testing API:', error);
    return null;
  }
}

// Test 3: Check if image file exists
async function testImageFile(imageUrl) {
  console.log('\nStep 3: Testing image file access...');
  console.log('Image URL:', imageUrl);
  
  try {
    const response = await fetch(imageUrl);
    console.log('✅ Image file exists (Status:', response.status, ')');
    return true;
  } catch (error) {
    console.error('❌ Image file not found:', error);
    return false;
  }
}

// Main test flow
async function runRegistrationTests(professorId) {
  console.clear();
  console.log('╔════════════════════════════════════════════╗');
  console.log('║  Professor Registration Check Test Suite  ║');
  console.log('╚════════════════════════════════════════════╝\n');
  
  const registrationData = await testRegistrationCheck(professorId);
  
  if (registrationData && registrationData.isRegistered && registrationData.registration) {
    const imageExists = await testImageFile(registrationData.registration.image_url);
    
    console.log('\n═══════════════════════════════════════════════');
    console.log('RESULTS:');
    console.log('═══════════════════════════════════════════════');
    console.log('✅ Registration Found:', registrationData.isRegistered);
    console.log('✅ Image Accessible:', imageExists);
    console.log('✅ Ready to proceed to shift UI');
    console.log('\nNext Step: Navigate to class attendance page');
    console.log('Expected: Should show shift open/close UI (NOT registration modal)');
  } else if (registrationData) {
    console.log('\n═══════════════════════════════════════════════');
    console.log('RESULTS:');
    console.log('═══════════════════════════════════════════════');
    console.log('❌ No Registration Found');
    console.log('ℹ️  You need to complete face registration first');
    console.log('\nAction: Complete facial registration when prompted');
  } else {
    console.log('\n═══════════════════════════════════════════════');
    console.log('ERROR: Could not reach API');
    console.log('═══════════════════════════════════════════════');
  }
  
  console.log('\n═══════════════════════════════════════════════');
}

// Usage Instructions (print to console)
console.log('═══════════════════════════════════════════════');
console.log('HOW TO USE THIS SCRIPT:');
console.log('═══════════════════════════════════════════════\n');
console.log('1. Make sure you are logged in as a professor');
console.log('2. Open browser console (F12 or Ctrl+Shift+I)');
console.log('3. Copy your Professor ID (UUID)');
console.log('4. Run: runRegistrationTests("YOUR_PROFESSOR_ID")\n');
console.log('Example: runRegistrationTests("550e8400-e29b-41d4-a716-446655440000")');
console.log('\n═══════════════════════════════════════════════');

// Export function for console use
window.testRegistration = runRegistrationTests;
console.log('\n✨ Script loaded! Use: testRegistration("your-professor-id")\n');
