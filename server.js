// Load environment variables from .env file during development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const { Strategy: GoogleStrategy } = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcryptjs');
const pool = require('./database'); // Import the PostgreSQL connection pool
const PDFParser = require('pdf-parse');
const fileUpload = require('express-fileupload');
const fs = require('fs');
const path = require('path');
const { validate_pdf } = require('./validate_pdf'); // Import validate_pdf function
const { process_loaded_payslip } = require('./split_sections');
const { send_to_postgres } = require('./payslip_insert');
const { list_users_payslips} = require('./data_functions/list_users_payslips');
const { load_single_payslip} = require('./data_functions/load_single_payslip');
const { json2csvAsync} = require( 'json-2-csv');
const excel = require( 'node-excel-export');

const app = express();
const port = 52535;

// Enable trust proxy
app.set('trust proxy', true);

// Middleware
// Parse URL-encoded bodies (for x-www-form-urlencoded)
app.use(express.urlencoded({ extended: true }));

// Parse JSON bodies (for application/json)
app.use(express.json());
app.use(session({
  secret: 'secret',
  resave: false,
  saveUninitialized: false,
}));
app.use(flash());
app.use(passport.initialize());
app.use(passport.session());
app.use(fileUpload({
  useTempFiles: true,
  tempFileDir: './tempFileDir/'
}));
app.set('view engine', 'ejs');

// Load environment variables
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// Middleware to restrict access to /register based on IP address
function restrictToIP(req, res, next) {
  const allowedIP = '82.15.180.223'; // Replace with your allowed IP address

  // Get the client IP address from the request headers
  const clientIP = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

  console.log(clientIP);

  // Check if the client IP matches the allowed IP
  if (clientIP !== allowedIP) {
    return res.status(403).send('Access Forbidden');
  }

  // If IP is allowed, proceed to the next middleware or route handler
  next();
}

// Middleware to check if user is authenticated
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/');
}


// Function to read a PDF file and return its text content
async function readPDF(file) {
  return new Promise((resolve, reject) => {
    try {
      const dataBuffer = fs.readFileSync(file);
      PDFParser(dataBuffer).then((data) => {
        resolve(data.text);
      }).catch((err) => {
        reject(err);
      });
    } catch (err) {
      console.error('Error reading PDF file:', err);
      reject(err);
    }
  });
}

// Helper function to get start and end dates for the tax year
function getTaxYearDates(year) {
  const startDate = new Date(year, 3, 6); // April 6
  const endDate = new Date(year + 1, 3, 5); // April 5 of next year
  return { startDate, endDate };
}

// Helper function to get start and end dates for the academic year
function getAcademicYearDates(year) {
  const startDate = new Date(year, 7, 1); // August 1
  startDate.setDate(startDate.getDate() + ((3 - startDate.getDay() + 7) % 7)); // First Wednesday in August
  const endDate = new Date(startDate);
  endDate.setFullYear(startDate.getFullYear() + 1);
  endDate.setDate(endDate.getDate() - 1); // One day before the same Wednesday next year
  return { startDate, endDate };
}

// Define a helper function to format dates
const formatDate = (timestamp) => {
  const date = new Date(timestamp);
  const formattedDate = `${date.getDate().toString().padStart(2, '0')}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getFullYear()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  return formattedDate;
};



// Middleware to make formatDate available to all EJS templates
app.use((req, res, next) => {
  res.locals.formatDate = formatDate;
  next();
});


// User Authentication
passport.use(new LocalStrategy(
  async (username, password, done) => {
    try {
      const res = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
      const user = res.rows[0];
      if (!user) {
        return done(null, false, { message: 'Incorrect username.' });
      }
      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        return done(null, false, { message: 'Incorrect password.' });
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: 'https://pay.tomludlow.co.uk/auth/google/callback'
}, async (token, tokenSecret, profile, done) => {
  try {
    const res = await pool.query('SELECT * FROM users WHERE provider = $1 AND provider_id = $2', ['google', profile.id]);
    let user = res.rows[0];
    
    if (!user) {
      // Generate username from email (remove dots and hyphens)
      const username = profile.emails[0].value.replace(/[^a-zA-Z0-9]/g, ''); // Remove dots and hyphens
      
      // Insert new user into database
      user = (await pool.query(
        'INSERT INTO users (email, username, provider, provider_id, oauth_token, user_category) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [profile.emails[0].value, username, 'google', profile.id, token, 'tier_2']
      )).rows[0];
    }
    
    return done(null, user);
  } catch (err) {
    return done(err);
  }
}));


passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const res = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    done(null, res.rows[0]);
  } catch (err) {
    done(err);
  }
});

// Routes
app.get('/', (req, res) => {
  res.render('index', { message: req.flash('error') });
});

// Route to serve the key_dict.json file
app.get('/data_functions/key_dict.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'data_functions', 'key_dict.json'));
});

// Serve payslip files dynamically based on logged-in user
app.use('/payslips', ensureAuthenticated, express.static(path.join(__dirname, 'payslips')));

// Example endpoint to handle PDF file
app.get('/payslips/:username/uploaded/:filename', ensureAuthenticated, (req, res) => {
  const { username, filename } = req.params;
  const filePath = path.join(__dirname, 'payslips', username, 'uploaded', filename);

  // Check if the file exists
  if (fs.existsSync(filePath)) {
    // Stream the PDF file back to the client
    res.sendFile(filePath);
  } else {
    res.status(404).send('File not found');
  }
});

app.get('/login', (req, res) => {
  res.render('login', { messages: req.flash() }); // Pass flash messages to the template
});

app.post('/login', passport.authenticate('local', {
  successRedirect: '/dashboard',
  failureRedirect: '/login',
  failureFlash: true
}));

app.get('/auth/google',
  passport.authenticate('google', { scope: ['https://www.googleapis.com/auth/plus.login', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/dashboard');
  }
);

app.post('/register', async (req, res) => {
  const { username, password, email, user_category } = req.body;
  const saltRounds = 10;

  try {
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    await pool.query(
      'INSERT INTO users (username, password, email, user_category) VALUES ($1, $2, $3, $4)',
      [username, hashedPassword, email, user_category]
    );
    req.flash('success', 'Registration successful. You can now log in.');
    res.redirect('/login'); // Redirect to the login page after successful registration
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'users_email_key') {
      req.flash('error', 'Email already registered.');
    } else {
      console.error(err);
      req.flash('error', 'Failed to register. Please try again later.');
    }
    res.redirect('/register');
  }
});

app.get('/register', restrictToIP, (req, res) => {
  res.render('register', { messages: req.flash() }); // Render the registration form
});


// Route handler for dashboard
app.get('/dashboard', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/');
  }

  const messages = req.flash() || {};
  const username = req.user.username; // Get the username from the authenticated user

  try {
    console.log("Attempting to load the relevant paylips");
    const result = await list_users_payslips(username);

    if (result.success) {
      res.render('dashboard', {
        user: req.user,
        messages: messages,
        payslips: result.data,
        message: result.message
      });
    } else {
      res.render('dashboard', {
        user: req.user,
        messages: messages,
        payslips: [],
        message: result.error
      });
    }
  } catch (error) {
    res.render('dashboard', {
      user: req.user,
      messages: messages,
      payslips: [],
      message: 'An unexpected error occurred: ' + error.message
    });
  }
});

app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Failed to logout');
    }
    res.redirect('/');
  });
});

// Route to view users (accessible only to admin)
app.get('/view_users', async (req, res) => {
  try {
    // Check if user is authenticated and is an admin
    if (!req.isAuthenticated() || req.user.user_category !== 'admin') {
      return res.redirect('/');
    }

    // Fetch users with their authentication provider information
    const users = await pool.query('SELECT id, username, email, user_category, provider FROM users');

    // Render the view_users.ejs template with the users data
    res.render('view_users', { users: users.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

// Route to update user category (accessible only to admin)
app.post('/update_user_category', async (req, res) => {
  try {
    // Check if user is authenticated and is an admin
    if (!req.isAuthenticated() || req.user.user_category !== 'admin') {
      return res.redirect('/');
    }
    
    const { userId, userCategory } = req.body;

    // Update user category in the database
    await pool.query('UPDATE users SET user_category = $1 WHERE id = $2', [userCategory, userId]);

    res.redirect('/view_users');
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

// Route to delete a user (accessible only to admin)
app.post('/delete_user', async (req, res) => {
  try {
    // Check if user is authenticated and is an admin
    if (!req.isAuthenticated() || req.user.user_category !== 'admin') {
      return res.status(403).send('Unauthorized'); // Send 403 Forbidden for unauthorized access
    }

    const userId = req.body.userId; // Assuming you pass userId via POST request

    // Delete the user from the database
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);

    res.redirect('/view_users'); // Redirect back to view_users page after deletion
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

// Route to change user password (accessible only to admin)
app.post('/change_password', async (req, res) => {
  try {
    // Check if user is authenticated and is an admin
    if (!req.isAuthenticated() || req.user.user_category !== 'admin') {
      return res.status(403).send('Unauthorized'); // Send 403 Forbidden for unauthorized access
    }

    const userId = req.body.userId; // Assuming you pass userId via POST request
    const newPassword = req.body.newPassword; // Assuming you pass newPassword via POST request

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update the user's password in the database
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, userId]);

    res.redirect('/view_users'); // Redirect back to view_users page after password change
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

// Route to serve upload page
app.get('/upload', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/');
  }
  
  res.render('upload', { messages: req.flash() });
});

// Route to handle file upload
app.post('/upload', ensureAuthenticated, async (req, res) => {
  console.log('req.files:', req.files); // Debugging output

  if (!req.files || !req.files.uploadedFile) {
    req.flash('error', 'No file uploaded.');
    return res.redirect('/upload');
  }

  const uploadedFile = req.files.uploadedFile;
  // Check file type (must be PDF)
  if (uploadedFile.mimetype !== 'application/pdf') {
    req.flash('error', 'Only PDF files are allowed.');
    return res.redirect('/upload');
  }

  try {
    const pdfContent = await readPDF(uploadedFile.tempFilePath);
    
    // Validate the PDF content
    const isValid = await validate_pdf(pdfContent);

    if (!isValid) {
      req.flash('error', 'Invalid PDF content.');
      return res.redirect('/upload');
    }

    // Save the file to /payslips/username/uploaded/
    const username = req.user.username;
    const uploadDir = path.join(__dirname, 'payslips', req.user.username, 'uploaded');
    // Check if the directory exists, create it if it doesn't
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true }); // recursive true creates parent directories if they don't exist
    }

    // Now move the file to the destination
    uploadedFile.mv(path.join(uploadDir, uploadedFile.name), (err) => {
      if (err) {
        console.error('Error saving file:', err);
        req.flash('error', 'Failed to save the file.');
        return res.redirect('/upload');
      }
      req.flash('success', 'File uploaded successfully.');
      res.redirect('/upload');
    });
  } catch (err) {
    console.error('Error processing upload:', err);
    req.flash('error', 'Failed to process the file.');
    res.redirect('/upload');
  }
});

// Route to render view_pending_payslips.ejs
app.get('/view_pending_payslips', ensureAuthenticated, async (req, res) => {
  const username = req.user.username;
  const directoryPath = path.join(__dirname, `payslips/${username}/uploaded`);

  try {
    // Read directory contents with file stats
    fs.readdir(directoryPath, (err, files) => {
      if (err) {
        console.error('Error reading directory:', err);
        req.flash('error', 'Failed to fetch pending payslips.');
        return res.redirect('/view_pending_payslips'); // Redirect to handle error
      }

      // Prepare an array to store file details
      const filesWithStats = [];

      // Iterate through files and get their stats
      files.forEach(file => {
        const filePath = path.join(directoryPath, file);
        const stats = fs.statSync(filePath);
        const createdAt = stats.birthtime; // File creation time

        filesWithStats.push({
          name: file,
          createdAt: createdAt,
        });
      });

      // Render view_pending_payslips.ejs with files list and their creation times
      res.render('view_pending_payslips', {
        files: filesWithStats,
        messages: {
          error: req.flash('error'),
          success: req.flash('success'),
        },
      });
    });
  } catch (err) {
    console.error('Error fetching payslips:', err);
    req.flash('error', 'Failed to fetch pending payslips.');
    res.redirect('/view_pending_payslips'); // Redirect to handle error
  }
});

// Route to process payslip
app.post('/process_payslip', ensureAuthenticated, async (req, res) => {
  const { filename } = req.body;

  // Assuming the path where payslips are stored
  const filePath = path.join(__dirname, 'payslips', req.user.username, 'uploaded', filename);

  try {
    // Read the PDF file
    const pdfText = await readPDF(filePath);
    // Process the loaded PDF
    const result = await process_loaded_payslip(pdfText, filename);

    // Render the approve_pending_payslip view with PDF and JSON content
    res.render('approve_pending_payslip', {
      pdfFilePath: `${filename}`,
      username: req.user.username,
      jsonContent: result,
      messages: { success: 'PDF processed successfully.' } // Flash message if needed
    });
  } catch (err) {
    console.error('Error processing payslip:', err);
    req.flash('error', 'Failed to process payslip.');
    res.redirect('/view_pending_payslips'); // Redirect to the pending payslips view on error
  }
});

// Route to render approve_pending_payslip view
app.get('/approve_pending_payslip', ensureAuthenticated, (req, res) => {
  res.render('approve_pending_payslip', {
    pdfFilePath: null,
    jsonContent: null,
    messages: { error: req.flash('error'), success: req.flash('success') }
  });
});


// POST endpoint to delete a payslip file
app.post('/delete-payslip', ensureAuthenticated, (req, res) => {
  const username = req.user.username; // Assuming you have user authentication
  const filename = req.body.filename; // Assuming the filename is sent in the request body

  if (!filename) {
    console.error('Error: filename is missing or undefined in request body');
    req.flash('error', 'Filename is required');
    return res.status(400).redirect('/view_pending_payslips'); // Redirect to view_pending_payslips with error message
  }

  // Correct directory path for uploaded payslips
  const payslipDirectory = path.join(__dirname, 'payslips', username, 'uploaded');
  const filePath = path.join(payslipDirectory, filename);

  fs.unlink(filePath, (err) => {
    if (err) {
      console.error('Error deleting file:', err);
      req.flash('error', 'Failed to delete payslip file.');
    } else {
      req.flash('success', 'Payslip deleted successfully.');
    }
    res.redirect('/view_pending_payslips'); // Redirect to the view_pending_payslips view
  });
});


// POST endpoint to submit a payslip
app.post('/submit-payslip', ensureAuthenticated, async (req, res) => {
  const username = req.user.username; // Assuming user authentication middleware sets req.user
  const formData = req.body; // Form data sent in the request body
  const isDuplicateConfirmed = formData.isDuplicateConfirmed === 'true'; // Convert to boolean

  // Remove isDuplicateConfirmed from formData
  const { isDuplicateConfirmed: _, ...filteredFormData } = formData;

  // Example console log to output formData
  console.log('Received payslip data for user:', username);
  console.log(filteredFormData);

  try {
    // Call the send_to_postgres function
    const result = await send_to_postgres(username, filteredFormData, isDuplicateConfirmed);

    // Ensure result is an object with status and message
    if (typeof result !== 'object' || result === null || !result.status || !result.message) {
      throw new Error('Unexpected result format');
    }

    if (result.status === 'duplicate') {
      req.flash('info', result.message);
      res.status(409).json({ message: result.message, status: 'duplicate', isDuplicate: true });
    } else if (result.status === 'success') {
      // Perform any additional processing like moving files
      if (formData.filename) {
        await tidy_up_submission(username, formData.filename);
      }
      req.flash('success', result.message);
      res.status(200).json({ message: result.message, status: 'success' });
    } else {
      throw new Error('Unexpected status received from database operation');
    }
  } catch (error) {
    console.error('Error submitting payslip:', error.message);
    req.flash('error', 'Failed to submit payslip.');
    res.status(500).json({ message: 'Failed to submit payslip.', status: 'error' });
  }
});


// Route to render the duplicate confirmation page
app.get('/confirm-duplicate', ensureAuthenticated, (req, res) => {
  const formData = req.query; // Retrieve form data from query parameters

  res.render('confirm_duplicate', { 
    messages: req.flash('info'),
    formData: formData
  });
});

// POST endpoint to handle duplicate confirmation
app.post('/submit-duplicate', ensureAuthenticated, async (req, res) => {
  const username = req.user.username;
  const formData = req.body;

  try {
    // Call send_to_postgres with isDuplicateConfirmed set to true
    const result = await send_to_postgres(username, formData, true);

    if (result.status === 'success') {
      await tidy_up_submission(username, formData.filename);
      req.flash('success', result.message);
      res.redirect('/dashboard');
    } else {
      req.flash('error', 'Failed to submit payslip.');
      res.redirect('/dashboard');
    }
  } catch (error) {
    console.error('Error submitting payslip:', error.message);
    req.flash('error', 'Failed to submit payslip.');
    res.redirect('/dashboard');
  }
});



// Function to move the file and ensure directories are created
async function tidy_up_submission(username, filename) {
  const uploadedDir = path.join(__dirname, 'payslips', username, 'uploaded');
  const processedDir = path.join(__dirname, 'payslips', username, 'processed');
  
  // Define source and destination paths
  const sourcePath = path.join(uploadedDir, filename);
  const destinationPath = path.join(processedDir, filename);
  
  // Ensure directories exist
  if (!fs.existsSync(uploadedDir)) {
    fs.mkdirSync(uploadedDir, { recursive: true });
  }
  if (!fs.existsSync(processedDir)) {
    fs.mkdirSync(processedDir, { recursive: true });
  }
  
  // Move the file from uploaded to processed
  return new Promise((resolve, reject) => {
    fs.rename(sourcePath, destinationPath, (err) => {
      if (err) {
        reject(new Error(`Failed to move file: ${err.message}`));
      } else {
        resolve();
      }
    });
  });
}


app.get('/view_payslip', async(req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/');
  }

  const username = req.user.username; // Assuming the username is stored in req.user
  const payslipId = req.query.payslip_id; // Get payslip_id from form submission

  console.log(username, payslipId);

  try {
    // Call the function to load the single payslip data
    const payslipData = await load_single_payslip(username, payslipId);

    // Render the payslip data on a new page or redirect with data if necessary
    // Assuming you want to render a page or pass data to another route
    res.render('view_payslip', {
      user: req.user,
      payslip: payslipData, // Send the payslip data to the view
      messages: req.flash() // Include any flash messages if applicable
    });

  } catch (error) {
    console.error('Error loading payslip:', error.message);
    req.flash('error', 'Failed to load payslip. Please try again.'); // Flash an error message
    res.redirect('/dashboard'); // Redirect back to the dashboard
  }
})

app.post('/view_payslip', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/');
  }

  const username = req.user.username; // Assuming the username is stored in req.user
  const payslipId = req.body.payslip_id; // Get payslip_id from form submission

  try {
    // Call the function to load the single payslip data
    const payslipData = await load_single_payslip(username, payslipId);

    // Render the payslip data on a new page or redirect with data if necessary
    // Assuming you want to render a page or pass data to another route
    res.render('view_payslip', {
      user: req.user,
      payslip: payslipData, // Send the payslip data to the view
      messages: req.flash() // Include any flash messages if applicable
    });

  } catch (error) {
    console.error('Error loading payslip:', error.message);
    req.flash('error', 'Failed to load payslip. Please try again.'); // Flash an error message
    res.redirect('/dashboard'); // Redirect back to the dashboard
  }
});


// Route to fetch payslip data filtered by tax year or academic year
app.get('/api/payslips', ensureAuthenticated, async (req, res) => {
  try {
    const { yearType, year } = req.query;

    let startDate, endDate;
    if (yearType === 'tax') {
      ({ startDate, endDate } = getTaxYearDates(parseInt(year)));
    } else if (yearType === 'academic') {
      ({ startDate, endDate } = getAcademicYearDates(parseInt(year)));
    } else {
      return res.status(400).json({ error: 'Invalid year type' });
    }

    const payslips = await pool.query(
      `SELECT id, username, demographics->>'location' AS location, job->>'job_title' AS job_title,
              job->>'department' AS department, this_period_summary->>'total_payments' AS total_payments,
              this_period_summary->>'total_deductions' AS total_deductions, this_period_summary->>'net_pay' AS net_pay,
              pay_date
       FROM payslips
       WHERE pay_date BETWEEN $1 AND $2 AND username = $3`,
      [startDate, endDate, req.user.username]
    );

    res.json(payslips.rows);
  } catch (error) {
    console.error('Error fetching payslips:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Route to export payslip data to JSON
app.get('/api/payslips/export/json', ensureAuthenticated, async (req, res) => {
  try {
    const { yearType, year } = req.query;

    let startDate, endDate;
    if (yearType === 'tax') {
      ({ startDate, endDate } = getTaxYearDates(parseInt(year)));
    } else if (yearType === 'academic') {
      ({ startDate, endDate } = getAcademicYearDates(parseInt(year)));
    } else {
      return res.status(400).json({ error: 'Invalid year type' });
    }

    const payslips = await pool.query(
      `SELECT id, username, demographics->>'location' AS location, job->>'job_title' AS job_title,
              job->>'department' AS department, this_period_summary->>'total_payments' AS total_payments,
              this_period_summary->>'total_deductions' AS total_deductions, this_period_summary->>'net_pay' AS net_pay,
              pay_date
       FROM payslips
       WHERE pay_date BETWEEN $1 AND $2 AND username = $3`,
      [startDate, endDate, req.user.username]
    );

    res.json(payslips.rows);
  } catch (error) {
    console.error('Error exporting payslips to JSON:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Route to export payslip data to Excel
app.get('/api/payslips/export/excel', ensureAuthenticated, async (req, res) => {
  try {
    const { yearType, year } = req.query;

    let startDate, endDate;
    if (yearType === 'tax') {
      ({ startDate, endDate } = getTaxYearDates(parseInt(year)));
    } else if (yearType === 'academic') {
      ({ startDate, endDate } = getAcademicYearDates(parseInt(year)));
    } else {
      return res.status(400).json({ error: 'Invalid year type' });
    }

    const payslips = await pool.query(
      `SELECT id, username, demographics->>'location' AS location, job->>'job_title' AS job_title,
              job->>'department' AS department, this_period_summary->>'total_payments' AS total_payments,
              this_period_summary->>'total_deductions' AS total_deductions, this_period_summary->>'net_pay' AS net_pay,
              pay_date
       FROM payslips
       WHERE pay_date BETWEEN $1 AND $2 AND username = $3`,
      [startDate, endDate, req.user.username]
    );

    // Define the Excel document structure
    const styles = {
      headerDark: {
        fill: {
          fgColor: {
            rgb: 'FF000000'
          }
        },
        font: {
          color: {
            rgb: 'FFFFFFFF'
          },
          sz: 14,
          bold: true,
          underline: true
        }
      }
    };

    const specification = {
      location: { displayName: 'Location', headerStyle: styles.headerDark, width: 120 },
      job_title: { displayName: 'Job Title', headerStyle: styles.headerDark, width: 120 },
      department: { displayName: 'Department', headerStyle: styles.headerDark, width: 120 },
      total_payments: { displayName: 'Total Payments', headerStyle: styles.headerDark, width: 120 },
      total_deductions: { displayName: 'Total Deductions', headerStyle: styles.headerDark, width: 120 },
      net_pay: { displayName: 'Net Pay', headerStyle: styles.headerDark, width: 120 },
      pay_date: { displayName: 'Pay Date', headerStyle: styles.headerDark, width: 120 }
    };

    const dataset = payslips.rows;

    const report = excel.buildExport([
      {
        name: 'Payslips',
        specification: specification,
        data: dataset
      }
    ]);

    res.attachment('payslips.xlsx');
    return res.send(report);
  } catch (error) {
    console.error('Error exporting payslips to Excel:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/payslip_table', ensureAuthenticated, (req, res) => {
  res.render('payslip_table');
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});




