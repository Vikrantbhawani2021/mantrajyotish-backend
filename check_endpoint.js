const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");

dotenv.config();

const token = jwt.sign(
    { userId: "6a7468de5d8022a395c81e0c", role: "astrologer" },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
);

console.log("Generated Token:", token);

fetch("http://localhost:3000/api/astrologer/approval-status", {
    method: "GET",
    headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
    }
})
.then(res => res.json())
.then(json => {
    console.log("Response:", JSON.stringify(json, null, 2));
})
.catch(err => {
    console.error("Error:", err);
});
