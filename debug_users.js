async function checkUsers() {
    try {
        const response = await fetch('http://localhost:3000/api/admin/users');
        const users = await response.json();
        
        console.log('--- Debug Users API ---');
        console.log(`Total users: ${users.length}`);
        
        users.forEach(u => {
            console.log(`ID: ${u.id} | Name: ${u.name} | Plan: ${u.plan} | PaymentStatus: ${u.payment_status} | DueDate: ${u.due_date} | Typeof DueDate: ${typeof u.due_date}`);
            
            // Simular lógica do frontend
            const today = new Date().toISOString().split('T')[0];
            const isLate = u.due_date && u.due_date < today;
            const isPaid = u.payment_status === 'paid';
            const isFree = u.plan === 'free';
            
            let status = 'NORMAL';
            if (isFree) status = 'FREE';
            else if (u.payment_status === 'overdue' || (isLate && !isPaid)) status = 'VENCIDO (Should trigger)';
            
            console.log(`   -> Frontend Logic Check: Today=${today}, isLate=${isLate}, Status=${status}`);
            console.log('-------------------------');
        });
        
    } catch (error) {
        console.error('Error fetching users:', error.message);
    }
}

checkUsers();
