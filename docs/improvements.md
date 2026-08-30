1. After you play a mistake, inaccuracy, or blunder, there should be an option to see engine refutation.  (example: on a position you are reviewing, you play Nxc3 which is a mistake. The same option for an engine refutation shows up and you can see why Nxc3 is a mistake.)
2. Vault and such needs an icon
Where you blunder should turn into actionable insight: drill opening blunders now, drill middle game blunders, etc. 

3. Openings and Time Per Move should be actionable insights: review all your blunders from this opening. Review all your time trouble blunders. Review all your long think blunders. 

4. Roughly equal, already winning, already losing need quantitative values so the user understands what that means. (10% chance of winning) or -10

5. Loading state in between training positions needs to be skeleton too, or better yet, cache the next position for instant loading. 

6. "New" tag isn’t standing out, and the refutation isn’t showing

7. Batching. So new blunders go into a new batch.  You can discard a batch or a problem if you don’t like them (with pro). This keeps things to a manageable 100 blunders per batch. 

8. The spaced repetition thing is a little bit awkward. It should be, you get 2 weeks or less to solve the first batch. Then you get one week or less. Then 3 days or less. Then one day or less. 

9. Social proof ( we should be tracking elo gain from account inception to current status (everytime we sync we can check the user's elo and compare.))

10. code audit for redundancy, issues, or bad stuff. 

11. Spaced repition means that if I fail a position, it should get moved into the queue 3-7 positions later until I get it correctly, then it moves to the end. (research how anki or other spaced repition trainers do it. base it on science)

12. How does this scale given chess.com and lichess ratelimiting? (research first)



New:
Onboarding errors: contentScript.bundle.js:1 Executing inline script violates the following Content Security Policy directive 'script-src 'self' 'wasm-unsafe-eval' 'inline-speculation-rules' chrome-extension://8cad4477-1036-4a38-bddd-0fc24166a900/'. Either the 'unsafe-inline' keyword, a hash ('sha256-YovrZVYF56995nY6CSzWI89Wg8JftMKnbPvjulU8aMg='), or a nonce ('nonce-...') is required to enable inline execution. The action has been blocked.
index-DtFKQukv.js:189 
 POST https://ydfwppthwnlgxnntzrvg.supabase.co/rest/v1/rpc/claim_blunders_for_user 404 (Not Found)
(anonymous)	@	index-DtFKQukv.js:189
(anonymous)	@	index-DtFKQukv.js:189
await in (anonymous)		
(anonymous)	@	index-DtFKQukv.js:166
then	@	index-DtFKQukv.js:166


Rating progress shows progress and change despite initially onboarding. 
No copy about how new games will be added to the vault. 
onboarding flow makes you go to user profile, when you should have a separate clear flow. 
You should also be able to initially select which types of games you count for training (existing settings in user info page)
In smaller screens, the new moves shown moves the screen focus down, when we should be able to stay on the board. 



new thought: we need to constantly be updating the pv for a blunder based on the engine searching deeper. The engine should never really be idle. 
Endgames this is especially prevalent. 
Suggested trainings based on the blunders (for instace, knight vs bishop endgames when you miss a point in that) Lucena position, phildor position, etc