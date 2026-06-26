## Inspiration
Every day, millions of people face unpredictable and dangerous road conditions, especially in developing regions. Conventional map apps like Google Maps just give you directions—they assume all roads are perfectly paved and ignore temporary, real-world dangers like deep potholes, waterlogging, or sudden debris. This blind navigation leads to serious safety risks and vehicle damage. We wanted to solve this by empowering the community to automatically map out these hazards without requiring any extra effort from the driver.

## What it does
StreetIQ is a smart, AI-powered navigation platform. It provides turn-by-turn directions just like a normal GPS, but it also uses your phone's camera as an active dashcam. While you drive, the app constantly watches the road ahead. Our on-device AI automatically spots hazards (like potholes, cracks, and debris). When a hazard is detected, StreetIQ instantly updates the maps of all other nearby drivers, warning them before they reach the danger. It turns everyday drivers into an automated network of road surveyors.

## How we built it
We built the app with a modern tech stack focused on speed and privacy:
- **Frontend & Maps:** We used React (Vite) and React-Leaflet to create a smooth, responsive map interface.
- **Custom AI Engine:** Instead of using an external API, we manually collected data, labeled it, and trained our own YOLOv8 machine learning model tailored specifically for complex road conditions. 
- **In-Browser Inference:** We run the AI entirely in the browser using TensorFlow.js. This means the video processing happens directly on the user's phone—no private video footage is ever sent to a server.
- **Backend & Real-Time Sync:** We utilized Node.js with Supabase (PostgreSQL + PostGIS). Using WebSockets, the moment a hazard is detected, its GPS location is instantly broadcasted to everyone else's map.

## Challenges we ran into
- **Browser-Based AI:** Running a complex AI model inside a mobile browser without lagging or killing the battery was extremely difficult. We had to highly optimize the inference loop to keep it running smoothly at 15 frames per second.
- **Training from Scratch:** Because generic AI models weren't accurate enough for our needs, we had to build our own. Gathering thousands of real-world street images, manually drawing bounding boxes around hazards, and adjusting the model's training parameters took a massive amount of time and effort.
- **Smart Logic:** We had to implement "Smart Motion Gating" to pause the AI when a car stops at a red light. This prevents the app from sending hundreds of duplicate reports for the same pothole while the car is idling.

## Accomplishments that we're proud of
- We are incredibly proud that we built and trained our own AI model from scratch rather than relying on paid, third-party AI tools or APIs.
- We successfully proved that we can run real-time computer vision directly in the browser, keeping user data 100% private.
- Even though the project is in a pre-beta stage—since training a globally perfect model takes vast amounts of time—we successfully created our own custom weights to prove the concept works perfectly on our own tech.

## What we learned
- We gained deep, hands-on experience with TensorFlow.js and how to deploy machine learning models to the web.
- We learned the hard reality of AI training: high-quality data labeling is just as important as the code itself to reduce "false positives" (like the AI thinking a shadow is a pothole).
- We learned how to handle real-time spatial data and instantly sync map updates across multiple users using WebSockets and Supabase.

## What's next for StreetIQ
- **Expanding the AI:** We plan to gather more diverse training data to make our model smarter in difficult conditions, such as heavy rain or night driving.
- **Full Beta Testing:** We want to roll out a localized beta test in a specific city to see how the crowdsourced data network performs with hundreds of active drivers.
- **City Partnerships:** In the future, we want to provide municipal governments with an analytics dashboard. Instead of sending out surveyors, cities can instantly see exactly which roads are deteriorating the fastest and prioritize repairs based on our real-time community data.

## My Contributions
- **Custom AI Training:** Curated data and trained our YOLOv8 hazard detection model from scratch.
- **Routing Algorithm:** Developed the pathfinding logic to calculate the shortest and most efficient navigation routes.
- **AI Integration:** Successfully embedded the trained model into the application for real-time, on-device hazard detection.
