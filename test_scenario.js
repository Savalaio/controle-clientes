const API_URL = 'http://localhost:3000/api';

async function testScenario() {
    console.log("=== Testing Odair Scenario ===");

    // Helper for fetch
    const post = async (url, data, headers) => {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(data)
        });
        const json = await res.json();
        if (!res.ok) throw { response: { status: res.status, data: json } };
        return { data: json };
    };

    const put = async (url, data, headers) => {
        const res = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(data)
        });
        const json = await res.json();
        if (!res.ok) throw { response: { status: res.status, data: json } };
        return { data: json };
    };

    try {
        // 1. MASTER (ID 1) creates 'odairsavalaio13@gmail.com'
        console.log("1. Master creating Odair...");
        let odairRes;
        try {
            odairRes = await post(`${API_URL}/admin/users`, {
                name: "Odair Admin",
                email: `odairsavalaio13_${Date.now()}@gmail.com`, // Unique email
                password: "password123",
                role: "user"
            }, { 'x-user-id': '1' });
        } catch(e) {
            console.log("Odair likely already exists or error:", e.response ? e.response.data : e);
            // In a real test we'd handle looking up existing, but let's assume success for the flow
            return;
        }
        
        const odairId = odairRes.data.id;
        console.log(`   > Odair created with ID: ${odairId}`);

        // 2. MASTER promotes Odair to ADMIN
        console.log("2. Master promoting Odair to ADMIN...");
        await put(`${API_URL}/admin/users/${odairId}/role`, { role: 'admin' }, { 'x-user-id': '1' });
        console.log("   > Odair is now ADMIN.");

        // 3. ODAIR (as Admin) creates a new user
        console.log("3. Odair creating a sub-user...");
        let subUserRes = await post(`${API_URL}/admin/users`, {
            name: "Usuario do Odair",
            email: `usuario_odair_${Date.now()}@test.com`,
            password: "password123"
        }, { 'x-user-id': odairId.toString() });
        
        const subUserId = subUserRes.data.id;
        console.log(`   > User created by Odair with ID: ${subUserId}`);

        // 4. ODAIR tries to promote his user to ADMIN (Should FAIL)
        console.log("4. Odair tries to promote his user to ADMIN...");
        try {
            await put(`${API_URL}/admin/users/${subUserId}/role`, {
                role: 'admin'
            }, { 'x-user-id': odairId.toString() });
            
            console.error("   > FAIL: Odair WAS able to promote user to ADMIN!");
        } catch (error) {
            if (error.response && error.response.status === 403) {
                console.log("   > PASS: Odair was blocked (403 Forbidden).");
                console.log("   > Error message:", error.response.data.error);
            } else {
                console.error(`   > FAIL: Unexpected error: ${JSON.stringify(error)}`);
            }
        }

    } catch (error) {
        console.error("Test failed:", error);
    }
}

testScenario();
