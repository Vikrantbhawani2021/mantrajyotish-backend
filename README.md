# Backend API Service

A professional, modular Node.js Express backend application designed for real-time video session booking, astrologer interviews, chat sessions, wallet management, and secure payments.

---

## 🚀 Architecture & File Structure

The project follows a standard model-view-controller (MVC) architecture styled for scalability and readability.

```
├── server.js               # Entry point of the server with http & Socket.io integration
├── render.yaml             # Render deployment configuration
├── src/
│   ├── app.js              # Express app setup and middleware routing configuration
│   ├── config/             # Configuration folder (database, Socket.io, credentials validation)
│   ├── constants/          # Application constants
│   ├── controllers/        # Route controllers (handling requests/responses)
│   ├── middlewares/        # Express custom middlewares (authentication, global error handling)
│   ├── models/             # Mongoose (MongoDB) database schemas
│   ├── routes/             # Express routes defining API endpoints
│   ├── services/           # Business logic layer (authentication, payment processing, mailing)
│   └── utils/              # Helper utilities (JWT tokens, general helpers)
```

---

## 🛠️ Tech Stack & Dependencies

- **Runtime Environment:** [Node.js](https://nodejs.org/)
- **Web Framework:** [Express.js](https://expressjs.com/) (v5)
- **Database Wrapper:** [Mongoose](https://mongoosejs.com/) (MongoDB)
- **Real-Time Communication:** [Socket.io](https://socket.io/)
- **Video Call Integration:** [Agora SDK](https://www.agora.io/)
- **SMS & Communications:** [Twilio](https://www.twilio.com/)
- **Media Uploads:** [Cloudinary](https://cloudinary.com/) & [Multer](https://github.com/expressjs/multer)
- **Mail Service:** [Nodemailer](https://nodemailer.com/)

---

## ⚙️ Environment Variables

Create a `.env` file in the root directory and add the following keys:

```env
PORT=3000
MONGO_URI=mongodb://localhost:27017/backend
JWT_SECRET=your_jwt_secret_here
JWT_EXPIRES_IN=7d

# Tulo Integration
TULO_JWT_SECRET=your_tulo_jwt_secret

# Twilio Configuration (Deprecated)
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_SERVICE_SID=your_twilio_service_sid

# Fast2SMS Configuration
FAST2SMS_API_KEY=your_fast2sms_api_key_here

# SMTP configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_smtp_email
SMTP_PASS=your_smtp_password
EMAIL_FROM=noreply@digitalinapp.com
```

---

## 🏁 How to Run Locally

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
```
The server will boot up by default on `http://localhost:3000`. You will see startup logs detailing MongoDB and Socket.io statuses.
