async function wakeUpRecaptchaApi() {
    try {
        await fetch(process.env.RECAPTCHA_API_URL);
    }
    catch (error) {
        await fetch(process.env.RECAPTCHA_API_WAKE_UP_URL);
        let attempts = 0;
        while (true) {
            try {
                await fetch(process.env.RECAPTCHA_API_URL);
                break;
            } catch (error) {
                attempts++;
                if (attempts >= 60) {
                    throw new Error('Failed to connect to the reCAPTCHA API after multiple attempts:', error);
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }
}

export { wakeUpRecaptchaApi };