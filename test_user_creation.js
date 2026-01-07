async function testUserCreation() {
    try {
        // 1. Register new user
        const timestamp = Date.now();
        const newUser = {
            name: `Test User ${timestamp}`,
            email: `test${timestamp}@example.com`,
            password: 'password123',
            whatsapp: '11999999999',
            cpf: '123.456.789-00'
        };

        console.log('Registering user:', newUser.email);
        const regRes = await fetch('http://localhost:3000/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newUser)
        });
        const regData = await regRes.json();
        console.log('Register Response:', regData);

        // 2. Fetch admin users list
        console.log('Fetching admin users list...');
        const listRes = await fetch('http://localhost:3000/api/admin/users');
        const listData = await listRes.json();
        
        // 3. Find the new user
        const createdUser = listData.find(u => u.email === newUser.email);
        
        if (createdUser) {
            console.log('User found in admin list:');
            console.log(JSON.stringify(createdUser, null, 2));
            
            // Analyze fields relevant to UI
            console.log('--- UI Logic Analysis ---');
            console.log(`Plan: ${createdUser.plan}`);
            console.log(`Payment Status: ${createdUser.payment_status}`);
            console.log(`Due Date: ${createdUser.due_date}`);
            
            if (createdUser.plan === 'free') {
                console.log('Expected UI: Badge GRÁTIS (Green)');
            } else {
                console.log('Expected UI: Depends on payment status/due date');
            }
        } else {
            console.error('User NOT found in admin list!');
        }

    } catch (error) {
        console.error('Error:', error);
    }
}

testUserCreation();
