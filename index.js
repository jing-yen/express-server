require('dotenv').config();

const express = require("express");
const path = require('path');
const app = express();
const cors = require("cors");
const pool = require("./database/db");
const PORT = process.env.PORT || 5000;

const axios = require('axios');
const POWER_AUTOMATE_URL = 'https://prod-38.southeastasia.logic.azure.com:443/workflows/c84d30f1f09a4a508d19460c586eb699/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=iEx2kAsMLbNfEaMAIn6_rhJhtNq1yQ868rnFvmqouP8';

// middleware
app.use(cors());
app.use(express.json());

// ROUTES //

app.get('/', (req, res) => {
    res.send('Temporary response for debugging');
});


app.get('/api/inventory', async (req, res) => {
    try {
        // Adjusted SQL query to only select items where loanable is 'Yes'
        const allInventory = await pool.query("SELECT * FROM hub_items_unique WHERE loanable = 'true'");
        res.json(allInventory.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});

app.get('/api/inventoryE2A', async (req, res) => {
    try {
        // Adjusted SQL query to only select items where loanable is 'Yes'
        const allInventory = await pool.query("SELECT * FROM e2a_items_unique WHERE loanable = 'true'");
        res.json(allInventory.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});

app.get('/api/loan-details/:loan_id', async (req, res) => {
    try {
        const { loan_id } = req.params;
        const loanDetails = await pool.query(
            `SELECT 
                lt.transaction_id, 
                s.name AS student_name, 
                s.email AS student_email,
                s.phone_number AS student_phone,
                lt.start_usage_date, 
                lt.end_usage_date, 
                lt.status, 
                json_agg(
                    json_build_object(
                        'item_name', COALESCE(hi.item_name, hi2.item_name),
                        'quantity', COALESCE(li.quantity, li2.quantity)
                    )
                ) AS loan_items
            FROM 
                loan_transaction lt
            JOIN 
                students s ON lt.student_id = s.student_id
            LEFT JOIN 
                loan_items li ON lt.transaction_id = li.transaction_id
            LEFT JOIN 
                hub_items_unique hi ON li.item_id = hi.item_id
            LEFT JOIN 
                loan_items_e2a li2 ON lt.transaction_id = li2.transaction_id
            LEFT JOIN 
                e2a_items_unique hi2 ON li2.item_id = hi2.item_id 
            WHERE 
                (UPPER(lt.hash) = UPPER($1) OR (lt.hash is NULL AND (lt.transaction_id)::TEXT = $1))
            GROUP BY 
                lt.transaction_id, s.name, s.email, s.phone_number, lt.start_usage_date, lt.end_usage_date, lt.status;
            `,
            [loan_id]
        );

        if (loanDetails.rows.length > 0) {
            res.json(loanDetails.rows[0]);
        } else {
            res.status(404).send("Loan details not found");
        }
    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});

app.get('/api/loan-transactions', async (req, res) => {
    try {
      const query = `
        SELECT 
            lt.transaction_id, 
            s.name AS student_name, 
            s.email AS student_email,
            s.phone_number AS student_phone,
            lt.remarks,
            lt.updated_by,
            lt.start_usage_date, 
            lt.end_usage_date, 
            lt.status,
            lt.location,
            json_agg(
                json_build_object(
                    'item_name', COALESCE(hi.item_name, hi2.item_name),
                    'quantity', COALESCE(li.quantity, li2.quantity)
                )
            ) AS loan_items
        FROM 
            loan_transaction lt
        JOIN 
            students s ON lt.student_id = s.student_id
        LEFT JOIN 
            loan_items li ON lt.transaction_id = li.transaction_id
        LEFT JOIN 
            hub_items_unique hi ON li.item_id = hi.item_id
        LEFT JOIN 
            loan_items_e2a li2 ON lt.transaction_id = li2.transaction_id
        LEFT JOIN 
            e2a_items_unique hi2 ON li2.item_id = hi2.item_id 
        GROUP BY 
            lt.transaction_id, s.name, s.email, s.phone_number, lt.start_usage_date, lt.end_usage_date, lt.status;

      `;
  
      const results = await pool.query(query);
      res.status(200).json(results.rows);
    } catch (err) {
      console.error(err.stack);
      res.status(500).json({ error: 'Server error' });
    }
  });


  app.get('/api/loan-transactions-overdue', async (req, res) => {
    try {
      const query = `
        SELECT 
            lt.transaction_id, 
            s.name AS student_name, 
            s.email AS student_email,
            s.phone_number AS student_phone,
            lt.remarks,
            lt.updated_by,
            lt.start_usage_date, 
            lt.end_usage_date, 
            lt.status,
            lt.hash,
            json_agg(
                json_build_object(
                    'item_name', COALESCE(hi.item_name, hi2.item_name),
                    'quantity', COALESCE(li.quantity, li2.quantity)
                )
            ) AS loan_items
        FROM 
            loan_transaction lt
        LEFT JOIN 
            students s ON lt.student_id = s.student_id
        LEFT JOIN 
            loan_items li ON lt.transaction_id = li.transaction_id
        LEFT JOIN 
            hub_items_unique hi ON li.item_id = hi.item_id
        LEFT JOIN 
            loan_items_e2a li2 ON lt.transaction_id = li2.transaction_id
        LEFT JOIN 
            e2a_items_unique hi2 ON li2.item_id = hi2.item_id 
        WHERE 
            lt.end_usage_date < CURRENT_DATE AND lt.status = 'Borrowed'
        GROUP BY 
            lt.transaction_id, s.name, s.email, s.phone_number, lt.start_usage_date, lt.end_usage_date, lt.status;
      `;
  
      const results = await pool.query(query);
      res.status(200).json(results.rows);
    } catch (err) {
      console.error(err.stack);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.get('/api/loan-transactions-expiring', async (req, res) => {
    try {
      const query = `
        SELECT 
            lt.transaction_id, 
            s.name AS student_name, 
            s.email AS student_email,
            s.phone_number AS student_phone,
            lt.remarks,
            lt.updated_by,
            lt.start_usage_date, 
            lt.end_usage_date, 
            lt.status, 
            lt.hash,
            json_agg(
                json_build_object(
                    'item_name', COALESCE(hi.item_name, hi2.item_name),
                    'quantity', COALESCE(li.quantity, li2.quantity)
                )
            ) AS loan_items
        FROM 
            loan_transaction lt
        LEFT JOIN 
            students s ON lt.student_id = s.student_id
        LEFT JOIN 
            loan_items li ON lt.transaction_id = li.transaction_id
        LEFT JOIN 
            hub_items_unique hi ON li.item_id = hi.item_id
        LEFT JOIN 
            loan_items_e2a li2 ON lt.transaction_id = li2.transaction_id
        LEFT JOIN 
            e2a_items_unique hi2 ON li2.item_id = hi2.item_id 
        WHERE 
            lt.end_usage_date = CURRENT_DATE + INTERVAL '1 day'
        GROUP BY 
            lt.transaction_id, s.name, s.email, s.phone_number, lt.start_usage_date, lt.end_usage_date, lt.status;

      `;
  
      const results = await pool.query(query);
      res.status(200).json(results.rows);
    } catch (err) {
      console.error(err.stack);
      res.status(500).json({ error: 'Server error' });
    }
  });

// Endpoint to get size_specs and model by item_id
app.get('/api/item-details/:item_id', async (req, res) => {
    try {
        const { item_id } = req.params;
        const itemDetails = await pool.query("SELECT model, size_specs FROM hub_items_new WHERE item_id = $1", [item_id]);

        if (itemDetails.rows.length === 0) {
            return res.status(404).json({ message: "Item details not found" });
        }

        res.json(itemDetails.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server error");
    }
});


// For retrieving details of a specific inventory item by its ID
app.get('/api/inventory/:item_id', async (req, res) => {
    try {
        // Extract the ID from the request parameters
        const { item_id } = req.params;

        // Perform a SELECT operation in the database using provided ID
        const item = await pool.query(
            "SELECT * FROM hub_items_unique WHERE item_id = $1", [item_id]
        );

        // Check if the item was found
        if (item.rows.length === 0) {
            return res.status(404).json({ message: "Item not found" });
        }
        res.json(item.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server error");
    }
});


// For adding a new inventory item
app.post('/api/inventory', async (req, res) => {
    try {
        const { item_name, total_qty } = req.body;

        const newItem = await pool.query(
            "INSERT INTO hub_items (item_name, total_qty) VALUES ($1, $2) RETURNING *",
            [item_name, total_qty]
        );
        res.json(newItem.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server error");
    }
});

// For deleting an inventory item by its ID
app.delete('/api/inventory/:item_id', async (req, res) => {
    try {

        // Extract ID from the requested parameters
        const { item_id } = req.params;

        // Perform DELETE operation in the database using the provided ID
        const deleteItem = await pool.query(
            "DELETE FROM hub_items WHERE item_id = $1 RETURNING *", [item_id]
        );

        // If no rows are returned, then the item does not exist
        if (deleteItem.rowCount === 0) {
            return res.status(404).json({ message: "Item not found" });
        }

        // Send a response indicating successful deletion
        res.json({ message: "Item deleted successfully" });
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server error");
    }
});


// For updating an existing inventory item by its ID
app.put('/api/inventory/:item_id', async (req, res) => {
    try {
        // Extract ID from request parameters
        const { item_id } = req.params;

        // Extract the data to be updated from the request body
        const { item_name, total_qty } = req.body;

        // Perform an UPDATE operation in database using provided ID and new data
        const updateItem = await pool.query(
            "UPDATE hub_items SET item_name = $1, total_qty = $2 WHERE item_id = $3 RETURNING *",
            [item_name, total_qty, item_id]
        );
        // If no rows are returned, then the item does not exist
        if (updateItem.rowCount === 0) {
            return res.status(404).json({ message: "Item not found" });
        }

        // Send a response with the updated item data
        res.json(updateItem.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server error");
    }
});

// For retrieving details of a specific inventory item from E2A by its ID
app.get('/api/inventoryE2A/:item_id', async (req, res) => {
    try {
        // Extract the ID from the request parameters
        const { item_id } = req.params;

        // Perform a SELECT operation in the database using provided ID
        const item = await pool.query(
            "SELECT * FROM e2a_items_unique WHERE item_id = $1", [item_id]
        );

        // Check if the item was found
        if (item.rows.length === 0) {
            return res.status(404).json({ message: "Item not found" });
        }
        res.json(item.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server error");
    }
});


// To validate the received data, check inventory availability, and update the database accordingly.
app.post('/api/excel-update', async (req, res) => {
    try {
        // Destructure the received data
        const {
            ID,
            completion_time,
            email,
            name,
            item_name_1,
            quantity_1,
            item_name_2,
            quantity_2,
            item_name_3,
            quantity_3,
            item_name_4,
            quantity_4,
            item_name_5,
            quantity_5,
            course_code, // Changed from project_title
            project_code,
            phone_number,
            start_usage_date,
            end_usage_date,
            project_supervisor_name,
            supervisor_email
        } = req.body;

        // Convert quantities from string to integer
        const convertedQuantity1 = parseInt(quantity_1) || 0;
        const convertedQuantity2 = quantity_2 ? parseInt(quantity_2) : null;
        const convertedQuantity3 = quantity_3 ? parseInt(quantity_3) : null;
        const convertedQuantity4 = quantity_4 ? parseInt(quantity_4) : null;
        const convertedQuantity5 = quantity_5 ? parseInt(quantity_5) : null;

        // Process date fields
        const processedCompletionTime = completion_time ? new Date(completion_time).toISOString() : null;
        const processedStartDate = start_usage_date ? new Date(start_usage_date).toISOString().split('T')[0] : null;
        const processedEndDate = end_usage_date ? new Date(end_usage_date).toISOString().split('T')[0] : null;

        const query = `
            INSERT INTO form_responses 
            (ID, completion_time, email, name, item_name_1, quantity_1, 
            item_name_2, quantity_2, item_name_3, quantity_3, 
            item_name_4, quantity_4, item_name_5, quantity_5, 
            course_code, project_code,
            phone_number, start_usage_date, end_usage_date, 
            project_supervisor_name, 
            supervisor_email, is_deleted) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, FALSE)
            ON CONFLICT (ID) DO UPDATE SET 
            completion_time = EXCLUDED.completion_time, 
            email = EXCLUDED.email,
            name = EXCLUDED.name,
            item_name_1 = EXCLUDED.item_name_1,
            quantity_1 = EXCLUDED.quantity_1,
            item_name_2 = EXCLUDED.item_name_2,
            quantity_2 = EXCLUDED.quantity_2,
            item_name_3 = EXCLUDED.item_name_3,
            quantity_3 = EXCLUDED.quantity_3,
            item_name_4 = EXCLUDED.item_name_4,
            quantity_4 = EXCLUDED.quantity_4,
            item_name_5 = EXCLUDED.item_name_5,
            quantity_5 = EXCLUDED.quantity_5,
            course_code = EXCLUDED.course_code, // Changed from project_title to course_code
            project_code = EXCLUDED.project_code,
            phone_number = EXCLUDED.phone_number,
            start_usage_date = EXCLUDED.start_usage_date,
            end_usage_date = EXCLUDED.end_usage_date,
            project_supervisor_name = EXCLUDED.project_supervisor_name,
            supervisor_email = EXCLUDED.supervisor_email,
            is_deleted = FALSE
        `;

        const values = [
            ID, processedCompletionTime, email, name, item_name_1, convertedQuantity1,
            item_name_2, convertedQuantity2, item_name_3, convertedQuantity3,
            item_name_4, convertedQuantity4, item_name_5, convertedQuantity5,
            course_code, // Changed from project_title
            project_code,
            phone_number, processedStartDate, processedEndDate,
            project_supervisor_name,
            supervisor_email
        ];

        await pool.query(query, values);

        // Start updating hub_items and creating transaction records
        await pool.query('BEGIN');

        // Iterate through each item and update hub_items
        for (let i = 1; i <= 5; i++) {
            const itemNameInput = req.body[`item_name_${i}`];
            const quantity = parseInt(req.body[`quantity_${i}`]) || 0;

            if (itemNameInput && quantity > 0) {
                const itemNameLower = itemNameInput.toLowerCase();

                // Find the item_id for the given item name (case-insensitive)
                const itemResult = await pool.query(
                    'SELECT item_id FROM hub_items WHERE LOWER(item_name) = LOWER($1)',
                    [itemNameLower]
                );

                if (itemResult.rows.length > 0) {
                    const itemId = itemResult.rows[0].item_id;

                    // Update qty_available and qty_reserved for the found item
                    await pool.query(
                        'UPDATE hub_items SET qty_available = qty_available - $1, qty_reserved = qty_reserved + $1 WHERE item_id = $2',
                        [quantity, itemId]
                    );
                } else {
                    // Handle the case where the item is not found
                    console.log(`Item not found: ${itemNameInput}`);
                    // Insert this incident into a 'log' table in your database
                    await pool.query('INSERT INTO item_lookup_errors (input_name, timestamp) VALUES ($1, NOW())', [itemNameInput]);
                }
            }
        }

        // Check if student exists
        let studentId;
        const studentResult = await pool.query('SELECT student_id FROM students WHERE email = $1', [email]);
        if (studentResult.rows.length > 0) {
            studentId = studentResult.rows[0].student_id;
        } else {
            // Insert new student and get student_id
            const newStudentResult = await pool.query(
                'INSERT INTO students (name, email, phone_number) VALUES ($1, $2, $3) RETURNING student_id',
                [name, email, phone_number]
            );
            studentId = newStudentResult.rows[0].student_id;
        }

        // Check if supervisor exists
        let supervisorId;
        const supervisorResult = await pool.query('SELECT supervisor_id FROM supervisors WHERE email = $1', [supervisor_email]);
        if (supervisorResult.rows.length > 0) {
            supervisorId = supervisorResult.rows[0].supervisor_id;
        } else {
            // Insert new supervisor and get supervisor_id
            const newSupervisorResult = await pool.query(
                'INSERT INTO supervisors (name, email) VALUES ($1, $2) RETURNING supervisor_id',
                [project_supervisor_name, supervisor_email]
            );
            supervisorId = newSupervisorResult.rows[0].supervisor_id;
        }

        await pool.query('COMMIT'); // Commit the transaction here
        res.status(200).json({ message: 'Data inserted successfully' });
    } catch (err) {
        await pool.query('ROLLBACK'); // Rollback in case of an error
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// To insert student data into the database using project code
app.post('/api/insert-students', async (req, res) => {
    try {
        // Destructure the received data
        const { name, email, phone_number, project_code } = req.body;

        // Check if the student already exists by project_code
        const existingStudent = await pool.query('SELECT student_id FROM students WHERE phone_number = $1', [phone_number]);

        if (existingStudent.rows.length === 0) {
            // If the student does not exist, insert them into the database
            await pool.query('INSERT INTO students (name, email, phone_number, project_code) VALUES ($1, $2, $3, $4)', [name, email, phone_number, project_code]);
            res.status(200).json({ message: 'Student data processed successfully' });
        } else {
            // If a student with the same project code exists, respond accordingly
            res.status(200).json({ message: 'Student with this phone number already exists' });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});



// To retrieve the student ID of a student using their email
app.get('/api/get-student-id', async (req, res) => {
    try {

        // Get email from query parameters
        const email = req.query.email;

        if (!email) {
            return res.status(400).json({ message: "Email is required" });
        }

        // Query the database to find the student_id by email
        const studentResult = await pool.query('SELECT student_id FROM students WHERE email ILIKE $1', [email]);

        if (studentResult.rows.length > 0) {
            // Student found, return the student_id
            const studentId = studentResult.rows[0].student_id;
            res.json({ student_id: studentId });
        } else {
            // Student not found
            res.status(404).json({ message: "Student not found" });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});



// To retrieve the transaction ID using the student's phone number
app.get('/api/get-transaction-id', async (req, res) => {
    try {
        const email = req.query.email; // Get email from query parameters

        if (!email) {
            return res.status(400).json({ message: "Email is required" });
        }

        // Query the database to find the transaction_id by email
        const transactionResult = await pool.query('SELECT transaction_id FROM loan_transaction WHERE email = $1', [email]);

        if (transactionResult.rows.length > 0) {
            // Transaction found, return the transaction_id
            const transId = transactionResult.rows[0].transaction_id;
            res.json({ transaction_id: transId });
        } else {
            // Transaction not found
            res.status(404).json({ message: "Transaction not found" });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});


app.post('/api/loan-transaction/add', async (req, res) => {
    try {
        // Destructure the required data from the request body
        const { student_id, email, start_usage_date, end_usage_date, status, location } = req.body;

        // Basic validation to check if all required fields are present
        if (!student_id || !email || !start_usage_date || !end_usage_date || !status || !location) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Verify if the student exists based on the email only
        const studentExists = await pool.query(
            "SELECT * FROM students WHERE email = $1",
            [email]
        );

        if (studentExists.rows.length === 0) {
            // If the student doesn't exist, respond with an error
            return res.status(404).json({ error: 'Student not found with the given email' });
        }

        // Get the student_id and phone_number from the studentExists query result
        const studentIdFromDB = studentExists.rows[0].student_id;
        const phoneNumberFromDB = studentExists.rows[0].phone_number;

        // Insert the new loan transaction data into the loan_transaction table using the student_id from the database
        const newLoanTransaction = await pool.query(
            "INSERT INTO loan_transaction (student_id, start_usage_date, end_usage_date, status, email, phone_number, location) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
            [studentIdFromDB, start_usage_date, end_usage_date, status, email, phoneNumberFromDB, location]
        );

        // Generate the hash for the transaction_id (safer)
        const updatedTransaction = await pool.query(
            "UPDATE loan_transaction SET hash = id_encode(transaction_id, '', 6, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890') WHERE transaction_id = $1 RETURNING *",
            [newLoanTransaction.rows[0].transaction_id]
        );

        newLoanTransaction.rows[0].hash = updatedTransaction.rows[0].hash;

        // Send back the inserted loan transaction data
        res.json(newLoanTransaction.rows[0]);
    } catch (err) {
        console.error(err.stack);
        res.status(500).send("Server error");
    }
});

app.post('/api/loan-item/add', async (req, res) => {
    const { transaction_id, item_id, quantity, status, remarks, location } = req.body;
  
    try {
      // Validate required fields
      if (!transaction_id || !item_id || !quantity || !status) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      console.log("Received loan item data:", req.body);
      console.log(transaction_id);
  
      // Insert the loan item into the database using pool.query
      const newLoanItem = await pool.query(
        "INSERT INTO " + (location=='hub' ? "loan_items" : "loan_items_e2a") + " (transaction_id, item_id, quantity, status, remarks) VALUES ($1, $2, $3, $4, $5) RETURNING *",
        [transaction_id, item_id, quantity, status, remarks]
      );
  
      // Return the created loan item
      return res.status(201).json(newLoanItem.rows[0]);
  
    } catch (err) {
      console.error(err.stack);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/api/loan-status/update', async (req, res) => {
    const { loan_id, status, date, staff_name, serial_numbers } = req.body;
  
    try {
        // Validate required fields
        if (!loan_id || !status) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
    
        console.log("Received loan update data:", req.body);
    
        // Update the loan item in the database
        var updatedLoanItem;
      
        if (status === 'Rejected') {
            updatedLoanItem = await pool.query(
                "UPDATE loan_transaction SET status = $1 WHERE transaction_id = $2 RETURNING *",
                [status, loan_id]
            );
        } else if (status === 'Completed') {
            updatedLoanItem = await pool.query(
                "UPDATE loan_transaction SET date_returned = $1, status = $2, updated_by = $3 WHERE transaction_id = $4 RETURNING *",
                [date, status, staff_name, loan_id]
            );
        }  else if (status === 'Borrowed') {
            updatedLoanItem = await pool.query(
                "UPDATE loan_transaction SET date_collected = $1, status = $2, updated_by = $3 ,remarks = $4 WHERE transaction_id = $5 RETURNING *",
                [date, status, staff_name, serial_numbers, loan_id]
            );
        }
  
      if (updatedLoanItem.rows.length === 0) {
        return res.status(404).json({ error: 'Loan item not found' });
      }

        // If item is marked as returned, update inventory (reduce reserved, increase available)
        if (status === 'Rejected')
            await pool.query(
                `UPDATE hub_items_unique hi
                SET qty_reserved = qty_reserved - li.quantity, 
                    qty_available = qty_available + li.quantity
                FROM loan_items li
                INNER JOIN loan_transaction lt ON lt.transaction_id = li.transaction_id
                WHERE li.item_id = hi.item_id
                AND lt.transaction_id = $1`,
                [loan_id]
            );
        else if (status === 'Completed')
            await pool.query(
                `UPDATE hub_items_unique hi
                SET qty_borrowed = qty_borrowed - li.quantity, 
                    qty_available = qty_available + li.quantity
                FROM loan_items li
                INNER JOIN loan_transaction lt ON lt.transaction_id = li.transaction_id
                WHERE li.item_id = hi.item_id
                AND lt.transaction_id = $1`,
                [loan_id]
            );
        else if (status === 'Borrowed')
            await pool.query(
                `UPDATE hub_items_unique hi
                SET qty_reserved = qty_reserved - li.quantity, 
                    qty_borrowed = qty_borrowed + li.quantity
                FROM loan_items li
                INNER JOIN loan_transaction lt ON lt.transaction_id = li.transaction_id
                WHERE li.item_id = hi.item_id
                AND lt.transaction_id = $1`,
                [loan_id]
            );
        
  
        // Return the updated loan item
        return res.status(200).json(updatedLoanItem.rows[0]);
  
    } catch (err) {
        console.error(err.stack);
        return res.status(500).json({ error: 'Server error' });
    }
  });


const formatDate = (date) => {
    const pad = (num) => num < 10 ? '0' + num : num.toString();

    // Convert to Singapore Time (GMT+8)
    const sgTimeOffset = 8 * 60; // offset in minutes
    date.setMinutes(date.getMinutes() + date.getTimezoneOffset() + sgTimeOffset);

    const month = pad(date.getMonth() + 1); // getMonth() is zero-based
    const day = pad(date.getDate());
    const year = date.getFullYear().toString().substr(-2); // last two digits of the year
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());

    return `${month}/${day}/${year} ${hours}:${minutes}:${seconds}`;
};

app.post('/api/submit-form', async (req, res) => {
    try {
        const {
            email, name, course_code, project_code,
            phone_number, start_usage_date, end_usage_date,
            project_supervisor_name, supervisor_email, location
        } = req.body;

        console.log("Received form data:", req.body);

        // Prepare the data for Power Automate, excluding purpose_of_usage
        let formData = {
            completion_time: formatDate(new Date()),
            email, name, course_code, project_code,
            phone_number, start_usage_date, end_usage_date, location
        };

        // Optionally add supervisor info if present
        if (project_supervisor_name && project_supervisor_name.trim() !== '') {
            formData.project_supervisor_name = project_supervisor_name;
        }

        if (supervisor_email && supervisor_email.trim() !== '') {
            formData.supervisor_email = supervisor_email;
        }

        // Handle item_id_, item_name_, and quantity_ fields dynamically
        Object.keys(req.body).forEach(key => {
            if (key.startsWith('item_id_') || key.startsWith('item_name_') || key.startsWith('quantity_')) {
                formData[key] = String(req.body[key]);
            }
        });

        // Forward the data to Power Automate
        const powerAutomateResponse = await axios.post(POWER_AUTOMATE_URL, formData);

        res.status(200).json({ message: 'Form data submitted successfully', powerAutomateResponse: powerAutomateResponse.data });
    } catch (err) {
        console.error("Error occurred:", err);
        res.status(500).send('Server error');
    }
});



app.post('/api/import-excel-data', async (req, res) => {
    const record = req.body; // The body is an object representing a single record
    let client;

    try {
        // Convert empty strings for numeric fields to null (or a default value)
        const convertToInt = (value) => value === "" ? null : parseInt(value, 10);

        const totalQty = convertToInt(record.TotalQty);
        const qtyAvailable = convertToInt(record.QtyAvailable);
        const qtyReserved = convertToInt(record.QtyReserved);
        const qtyBorrowed = convertToInt(record.QtyBorrowed);

        const loanable = record.Loanable === "Yes"; // Assuming Loanable is a Yes/No string
        const requiresApproval = record.RequiresApproval === "Yes"; // Assuming RequiresApproval is a Yes/No string

        // Extract new fields from the request body
        const model = record.Model;
        const sizeSpecs = record.SizeSpecs;
        const category = record.Category;

        client = await pool.connect();
        await client.query('BEGIN');
        
        console.log(record);
        
        if (record.Location=='hub' || record.Location=='e2a') {
            const result = await client.query(`
                INSERT INTO ` + (record.Location=='hub'? `hub_items_unique`: `e2a_items_unique`) +
                `
                (item_id, item_name, brand, total_qty, qty_available, qty_reserved, qty_borrowed, loanable, requires_approval, model, size_specs, category)
                VALUES
                ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                ON CONFLICT (item_id)
                DO UPDATE SET
                item_name = EXCLUDED.item_name,
                brand = EXCLUDED.brand,
                total_qty = EXCLUDED.total_qty,
                qty_available = EXCLUDED.qty_available,
                qty_reserved = EXCLUDED.qty_reserved,
                qty_borrowed = EXCLUDED.qty_borrowed,
                loanable = EXCLUDED.loanable,
                requires_approval = EXCLUDED.requires_approval,
                model = EXCLUDED.model,
                size_specs = EXCLUDED.size_specs,
                category = EXCLUDED.category;
            `, [
                record.ItemID, record.ItemName, record.Brand, totalQty, qtyAvailable, qtyReserved, qtyBorrowed, loanable, requiresApproval, model, sizeSpecs, category
            ]);

            await client.query('COMMIT');
            res.status(200).json({ message: 'Data imported successfully', result: result.rows });
        }
    } catch (err) {
        console.error('Error during data import:', err);
        if (client) {
            await client.query('ROLLBACK');
        }
        res.status(500).json({ message: 'Server error' });
    } finally {
        if (client) {
            client.release();
        }
    }
});


app.listen(PORT, '0.0.0.0', () => {
    console.log(`server has started on port ${PORT}`);
})
