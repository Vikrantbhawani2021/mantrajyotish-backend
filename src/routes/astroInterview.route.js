const express = require("express");

const router = express.Router();

const astroInterviewController = require("../controllers/astroInterview.controller");
const authMiddleware = require("../middlewares/auth.middleware");

// 1. Astrologer Requests Interview
router.post("/request", authMiddleware, astroInterviewController.requestInterview);

// 2. Admin Schedules Interview (Date, Time, Google Meet Link)
router.put("/schedule/:id", astroInterviewController.scheduleInterview);
router.put("/schedule", astroInterviewController.scheduleInterview);
router.post("/schedule", astroInterviewController.scheduleInterview);

// 3. Admin Evaluates Interview Result (Pass / Fail)
router.put("/result/:id", astroInterviewController.evaluateInterview);
router.put("/result", astroInterviewController.evaluateInterview);
router.post("/result", astroInterviewController.evaluateInterview);

// 3a. Direct Dedicated PASS Button APIs
router.put("/pass/:id", astroInterviewController.passInterview);
router.put("/pass", astroInterviewController.passInterview);
router.post("/pass", astroInterviewController.passInterview);

// 3b. Direct Dedicated FAIL Button APIs
router.put("/fail/:id", astroInterviewController.failInterview);
router.put("/fail", astroInterviewController.failInterview);
router.post("/fail", astroInterviewController.failInterview);

// 3c. Mark Interview Completed APIs
router.put("/complete/:id", astroInterviewController.completeInterview);
router.put("/complete", astroInterviewController.completeInterview);
router.post("/complete", astroInterviewController.completeInterview);

// 3d. Update Interview Notes APIs
router.put("/notes/:id", astroInterviewController.updateNotes);
router.put("/notes", astroInterviewController.updateNotes);
router.post("/notes", astroInterviewController.updateNotes);

// 4. Listing & Filtering (Admin)
router.get("/all", astroInterviewController.getAllInterviews);
router.get("/pending", astroInterviewController.getPendingInterviews);

// 5. Astrologer Fetch Interview Details (Date, Time, Meeting Link, Notes)
router.get("/details", astroInterviewController.getMyInterview);
router.get("/my-interview", astroInterviewController.getMyInterview);
router.get("/astrologer/:id", astroInterviewController.getMyInterview);

// 6. Token refresh/generation on-demand
router.get("/token/:id", astroInterviewController.getInterviewToken);

module.exports = router;
