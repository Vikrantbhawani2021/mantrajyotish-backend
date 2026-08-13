const adminMiddleware = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized - Access denied"
        });
    }

    if (req.user.role !== "admin" && req.user.role !== "superadmin") {
        return res.status(403).json({
            success: false,
            message: "Forbidden - Admin access required"
        });
    }

    next();
};

module.exports = adminMiddleware;
