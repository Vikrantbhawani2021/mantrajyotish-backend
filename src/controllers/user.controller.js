const User = require("../models/user.model");
const { generateToken } = require("../utils/jwt");

// 1. GET LOGGED-IN USER PROFILE
const getProfile = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        return res.status(200).json({
            success: true,
            data: user
        });

    } catch (error) {
        next(error);
    }
};

// 2. CREATE / REGISTER USER (With all step-by-step profile fields)
const registerUser = async (req, res, next) => {
    try {
        let {
            name,
            firstname,
            middlename,
            lastname,
            gender,
            dateofbirth,
            timeofbirth,
            placeofbirth,
            city,
            state,
            country,
            address,
            phone,
            email,
            role
        } = req.body;

        if (!phone) {
            return res.status(400).json({
                success: false,
                message: "Phone number is required"
            });
        }

        // Check existing user by phone
        let existingUser = await User.findOne({ phone });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: "User with this phone number already exists"
            });
        }

        if (name && typeof name === "string") {
            const parts = name.trim().split(/\s+/);
            firstname = parts[0] || "";
            lastname = parts.slice(1).join(" ") || "";
        } else if (firstname) {
            name = `${firstname} ${lastname || ""}`.trim();
        }

        const user = await User.create({
            name: name || null,
            firstname: firstname || null,
            middlename: middlename || null,
            lastname: lastname || null,
            gender: gender ? gender.toLowerCase() : null,
            dateofbirth: dateofbirth ? new Date(dateofbirth) : null,
            timeofbirth: timeofbirth || null,
            placeofbirth: placeofbirth || null,
            city: city || null,
            state: state || null,
            country: country || null,
            address: address || null,
            phone,
            email: email ? email.toLowerCase() : null,
            role: role || "user",
            isProfileCompleted: Boolean(name || (firstname && lastname))
        });

        const token = generateToken({
            userId: user._id,
            role: user.role
        });

        return res.status(201).json({
            success: true,
            message: "User created successfully",
            data: {
                user,
                token
            }
        });

    } catch (error) {
        next(error);
    }
};

// 3. GET ALL USERS (Admin / Listing)
const getAllUsers = async (req, res, next) => {
    try {
        const users = await User.find().sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            count: users.length,
            data: users
        });

    } catch (error) {
        next(error);
    }
};

// 4. GET SINGLE USER BY ID
const getUserById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const user = await User.findById(id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        return res.status(200).json({
            success: true,
            data: user
        });

    } catch (error) {
        next(error);
    }
};

// 5. UPDATE USER BY ID / PROFILE
const updateProfile = async (req, res, next) => {
    try {
        const userId = req.params.id || (req.user && req.user.userId);
        const updates = { ...req.body };

        if (updates.name && typeof updates.name === "string") {
            const parts = updates.name.trim().split(/\s+/);
            updates.firstname = parts[0] || "";
            updates.lastname = parts.slice(1).join(" ") || "";
        } else if (updates.firstname) {
            updates.name = `${updates.firstname} ${updates.lastname || ""}`.trim();
        }

        if (updates.gender) {
            updates.gender = updates.gender.toLowerCase();
        }

        if (updates.dateofbirth) {
            updates.dateofbirth = new Date(updates.dateofbirth);
        }

        updates.isProfileCompleted = true;

        const user = await User.findByIdAndUpdate(
            userId,
            { $set: updates },
            { new: true, runValidators: true }
        );

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "User profile updated successfully",
            data: user
        });

    } catch (error) {
        next(error);
    }
};

// 6. DELETE USER BY ID
const deleteUser = async (req, res, next) => {
    try {
        const { id } = req.params;
        const user = await User.findByIdAndDelete(id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "User deleted successfully"
        });

    } catch (error) {
        next(error);
    }
};

module.exports = {
    getProfile,
    registerUser,
    getAllUsers,
    getUserById,
    updateProfile,
    deleteUser
};