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


app.get('/dashboard', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/');
  }
  res.render('dashboard', { user: req.user });
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
      pdfFilePath: `/payslips/${req.user.username}/uploaded/${filename}`,
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
    return res.status(400).send('Filename is required');
  }

  const payslipDirectory = path.join(__dirname, '');
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
app.post('/submit-payslip', ensureAuthenticated, (req, res) => {
  const username = req.user.username; // Assuming you have user authentication
  const formData = req.body; // Assuming formData is sent in the request body

  // Example console log to output formData
  console.log('Received payslip data:');
  console.log(formData);

  // Example response
  res.status(200).send('Payslip submitted successfully.'); // Send a success response
});


app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});


