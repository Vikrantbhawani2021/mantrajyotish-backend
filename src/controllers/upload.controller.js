const cloudinaryService = require("../services/cloudinary.service");

// Upload Image (Base64 string, URL, or File multipart)
const uploadImage = async (req, res) => {
    try {
        let imageUrl = null;

        // 1. If file uploaded via Multer (multipart/form-data)
        if (req.file && req.file.buffer) {
            imageUrl = await cloudinaryService.uploadBuffer(req.file.buffer, "astro_uploads", req.file.mimetype);
        }
        // 2. If Base64 string or URL sent in body JSON
        else if (req.body && (req.body.image || req.body.file || req.body.base64)) {
            const input = req.body.image || req.body.file || req.body.base64;
            imageUrl = await cloudinaryService.uploadBase64OrUrl(input, "astro_uploads");
        }

        if (!imageUrl) {
            return res.status(400).json({
                success: false,
                message: "No image file or base64 string provided"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Image uploaded successfully to Cloudinary",
            url: imageUrl,
            data: {
                url: imageUrl
            }
        });

    } catch (error) {
        console.error("Upload Controller Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message || "Failed to upload image to Cloudinary"
        });
    }
};

module.exports = {
    uploadImage
};
