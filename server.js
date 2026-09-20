const express = require("express");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

app.use(express.json({ limit: "2mb" }));

// Serve the resume builder locally from the public folder
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_ENV = process.env.PAYPAL_ENV || "sandbox";

const PAYPAL_BASE_URL =
    PAYPAL_ENV === "production"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";

// Price of one PDF download
const PDF_PRICE = "1.00";
const PDF_CURRENCY = "USD";


// --------------------------------------------------
// HOME PAGE
// --------------------------------------------------

app.get("/", (req, res) => {
    res.redirect("/index.html");
});


// --------------------------------------------------
// Get PayPal Access Token
// --------------------------------------------------

async function getPayPalAccessToken() {
    if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
        throw new Error("PayPal credentials are missing.");
    }

    const auth = Buffer.from(
        `${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`
    ).toString("base64");

    const response = await fetch(
        `${PAYPAL_BASE_URL}/v1/oauth2/token`,
        {
            method: "POST",

            headers: {
                "Authorization": `Basic ${auth}`,
                "Content-Type": "application/x-www-form-urlencoded"
            },

            body: "grant_type=client_credentials"
        }
    );

    const data = await response.json();

    if (!response.ok) {
        console.error(
            "PayPal authentication error:",
            data
        );

        throw new Error(
            "Unable to authenticate with PayPal."
        );
    }

    return data.access_token;
}


// --------------------------------------------------
// PayPal Configuration
// --------------------------------------------------

app.get("/api/paypal/config", (req, res) => {

    res.json({
        clientId: PAYPAL_CLIENT_ID,
        currency: PDF_CURRENCY
    });

});


// --------------------------------------------------
// Create PayPal Order
// --------------------------------------------------

app.post("/api/paypal/create-order", async (req, res) => {

    try {

        const accessToken =
            await getPayPalAccessToken();

        const response = await fetch(
            `${PAYPAL_BASE_URL}/v2/checkout/orders`,
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                    "Authorization":
                        `Bearer ${accessToken}`
                },

                body: JSON.stringify({
                    intent: "CAPTURE",

                    purchase_units: [
                        {
                            amount: {
                                currency_code:
                                    PDF_CURRENCY,

                                value:
                                    PDF_PRICE
                            },

                            description:
                                "Professional Resume PDF Download"
                        }
                    ]
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {

            console.error(
                "Create order error:",
                data
            );

            return res.status(500).json({
                error:
                    "Unable to create PayPal order."
            });
        }

        res.json({
            id: data.id
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error:
                "Payment server error."
        });
    }

});


// --------------------------------------------------
// Capture PayPal Order
// --------------------------------------------------

app.post(
    "/api/paypal/capture-order",
    async (req, res) => {

        try {

            const { orderID } = req.body;

            if (!orderID) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Missing PayPal order ID."
                });

            }

            const accessToken =
                await getPayPalAccessToken();

            const response = await fetch(
                `${PAYPAL_BASE_URL}/v2/checkout/orders/${orderID}/capture`,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json",

                        "Authorization":
                            `Bearer ${accessToken}`
                    }
                }
            );

            const data = await response.json();

            if (!response.ok) {

                console.error(
                    "Capture order error:",
                    data
                );

                return res.status(500).json({
                    success: false,
                    error:
                        "Unable to capture payment."
                });

            }


            // Make sure PayPal says the order is completed

            if (data.status !== "COMPLETED") {

                return res.status(400).json({
                    success: false,
                    error:
                        "Payment was not completed."
                });

            }


            // Get the payment capture

            const capture =
                data.purchase_units?.[0]
                    ?.payments
                    ?.captures?.[0];

            if (!capture) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Payment information could not be verified."
                });

            }


            // Verify payment amount

            const paidAmount =
                capture.amount?.value;

            const paidCurrency =
                capture.amount?.currency_code;

            if (
                paidAmount !== PDF_PRICE ||
                paidCurrency !== PDF_CURRENCY
            ) {

                console.error(
                    "Payment amount mismatch:",
                    paidAmount,
                    paidCurrency
                );

                return res.status(400).json({
                    success: false,
                    error:
                        "Payment amount could not be verified."
                });

            }


            // Payment successful

            res.json({
                success: true,
                orderID: data.id,
                captureID: capture.id
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Payment verification failed."
            });

        }

    }
);


// --------------------------------------------------
// Local Server
// --------------------------------------------------

if (!process.env.VERCEL) {

    app.listen(PORT, () => {

        console.log(
            `Resume Builder running at http://localhost:${PORT}`
        );

        console.log(
            `PayPal environment: ${PAYPAL_ENV}`
        );

    });

}


// --------------------------------------------------
// Export Express App for Vercel
// --------------------------------------------------

module.exports = app;