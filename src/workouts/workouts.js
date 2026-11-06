/*
 * workouts.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * contains the project logic for this module and keeps related responsibilities together.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

let workouts = [
        `<workout_file>
    <author>Marinov</author>
    <name>Dijon</name>
    <category>VO2 Max</category>
    <description>60/60s or 60 sec ON at 121% of FTP followed by 60 sec OFF. In 2 groups by 8 reps each.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="120" PowerLow="0.32" PowerHigh="0.39"/>
        <SteadyState Duration="60" Power="0.39"/>
        <SteadyState Duration="60" Power="0.47"/>
        <SteadyState Duration="60" Power="0.55"/>
        <SteadyState Duration="60" Power="0.63"/>
        <IntervalsT Repeat="2" OnDuration="30" OffDuration="30" OnPower="0.98" OffPower="0.63"/>
        <SteadyState Duration="120" Power="0.5"/>
        <IntervalsT Repeat="8" OnDuration="60" OffDuration="60" OnPower="1.21" OffPower="0.44"/>
        <SteadyState Duration="300" Power="0.40"/>
        <IntervalsT Repeat="8" OnDuration="60" OffDuration="60" OnPower="1.21" OffPower="0.44"/>
        <SteadyState Duration="300" Power="0.40"/>
        <Cooldown Duration="300" PowerLow="0.39" PowerHigh="0.32"/>
    </workout>
</workout_file>
`,
`<workout_file>
    <author>Marinov</author>
    <name>Chili Pepper</name>
    <category>VO2 Max</category>
    <description> NOTE: This is mixed mode workout with slope targets in the main interval groups. 40/20s or 40 sec ON at 121% of FTP followed by 20 sec OFF, in 2 groups by 10 reps each.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="120" PowerLow="0.32" PowerHigh="0.39"/>
        <SteadyState Duration="45" Power="0.39" Cadence="80"/>
        <SteadyState Duration="45" Power="0.47" Cadence="90"/>
        <SteadyState Duration="45" Power="0.55" Cadence="100"/>
        <SteadyState Duration="45" Power="0.63" Cadence="90"/>
        <IntervalsT Repeat="2" OnDuration="30" OffDuration="30" OnPower="0.98" OffPower="0.63" Cadence="100" CadenceResting="80"/>
        <SteadyState Duration="90" Power="0.5" Slope="1"/>
        <IntervalsT Repeat="6" OnDuration="40" OffDuration="20" OnPower="1.21" OffPower="0.44" OnSlope="4" OffSlope="0" Cadence="90" CadenceResting="80"/>
        <SteadyState Duration="180" Power="0.40" Slope="1"/>
        <IntervalsT Repeat="6" OnDuration="40" OffDuration="20" OnPower="1.21" OffPower="0.44" OnSlope="4" OffSlope="0"/>
        <SteadyState Duration="180" Power="0.40"/>
        <Cooldown Duration="210" PowerLow="0.39" PowerHigh="0.32" />
    </workout>
</workout_file>
`,
`<workout_file>
    <author>Marinov</author>
    <name>Chili Pepper +1</name>
    <category>VO2 Max</category>
    <description>Short but tough, this is the hardest workout ever. It\'s gonna burn!</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="120" PowerLow="0.32" PowerHigh="0.39"/>
        <SteadyState Duration="60" Power="0.39"/>
        <SteadyState Duration="60" Power="0.47"/>
        <SteadyState Duration="60" Power="0.55"/>
        <SteadyState Duration="60" Power="0.63"/>
        <IntervalsT Repeat="2" OnDuration="30" OffDuration="30" OnPower="0.98" OffPower="0.63"/>
        <SteadyState Duration="120" Power="0.5"/>
        <SteadyState Duration="40" Power="1.31"/>
        <FreeRide Duration="20" />
        <SteadyState Duration="40" Power="1.31"/>
        <FreeRide Duration="20" />
        <SteadyState Duration="40" Power="1.31"/>
        <FreeRide Duration="20" />
        <SteadyState Duration="40" Power="1.31"/>
        <FreeRide Duration="20" />
        <SteadyState Duration="40" Power="1.31"/>
        <FreeRide Duration="20" />
        <SteadyState Duration="40" Power="1.31"/>
        <FreeRide Duration="20" />
        <SteadyState Duration="40" Power="1.31"/>
        <FreeRide Duration="20" />
        <SteadyState Duration="40" Power="1.31"/>
        <FreeRide Duration="20" />
        <SteadyState Duration="40" Power="1.31"/>
        <FreeRide Duration="20" />
        <SteadyState Duration="40" Power="1.31"/>
        <FreeRide Duration="20" />
        <FreeRide Duration="300" />
        <SteadyState Duration="40" Power="1.31"/>
        <FreeRide Duration="20" />
        <SteadyState Duration="40" Power="1.31"/>
        <FreeRide Duration="20" />
        <SteadyState Duration="40" Power="1.31"/>
        <FreeRide Duration="20" />
        <SteadyState Duration="40" Power="1.31"/>
        <FreeRide Duration="20" />
        <SteadyState Duration="40" Power="1.31"/>
        <FreeRide Duration="20" />
        <SteadyState Duration="40" Power="1.31"/>
        <FreeRide Duration="20" />
        <SteadyState Duration="40" Power="1.31"/>
        <FreeRide Duration="20" />
        <SteadyState Duration="40" Power="1.31"/>
        <FreeRide Duration="20" />
        <SteadyState Duration="40" Power="1.31"/>
        <FreeRide Duration="20" />
        <SteadyState Duration="40" Power="1.31"/>
        <FreeRide Duration="20" />
        <SteadyState Duration="300" Power="0.39"/>
        <Cooldown Duration="300" PowerLow="0.39" PowerHigh="0.32"/>
    </workout>
</workout_file>
`,
`<workout_file>
    <author>Athlima</author>
    <name>Quiche</name>
    <category>HIIT</category>
    <description>This workout features three 6-minute intervals that train your body to better manage and tolerate lactate buildup. You'll begin 'at' your FTP, increase to Zone 5 intensity (over), then finish with a Zone 3 effort (under).</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="300" PowerLow="0.25" PowerHigh="0.966"/>
        <SteadyState Duration="120" Power="0.5"/>
        <SteadyState Duration="120" Power="0.901"/>
        <SteadyState Duration="120" Power="1.053"/>
        <SteadyState Duration="120" Power="0.763"/>
        <SteadyState Duration="120" Power="0.5"/>
        <SteadyState Duration="120" Power="0.901"/>
        <SteadyState Duration="120" Power="1.053"/>
        <SteadyState Duration="120" Power="0.763"/>
        <SteadyState Duration="120" Power="0.5"/>
        <SteadyState Duration="120" Power="0.901"/>
        <SteadyState Duration="120" Power="1.053"/>
        <SteadyState Duration="120" Power="0.763"/>
        <SteadyState Duration="120" Power="0.5"/>
        <Cooldown Duration="180" PowerLow="0.75" PowerHigh="0.25"/>
    </workout>
</workout_file>`
,
`<workout_file>
    <author>Athlima</author>
    <name>Quiche +1</name>
    <category>HIIT</category>
    <description>This workout features two sets with 5 intervals each that train your body to better manage and tolerate lactate buildup. You'll begin 'at' your FTP, increase to Zone 5 intensity (over), then finish with a Zone 3 effort (under).</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="300" PowerLow="0.25" PowerHigh="0.966"/>
        <SteadyState Duration="60" Power="0.5"/>
        <SteadyState Duration="45" Power="0.901"/>
        <SteadyState Duration="45" Power="1.053"/>
        <SteadyState Duration="45" Power="0.763"/>
        <SteadyState Duration="60" Power="0.5"/>
        <SteadyState Duration="45" Power="0.901"/>
        <SteadyState Duration="45" Power="1.053"/>
        <SteadyState Duration="45" Power="0.763"/>
        <SteadyState Duration="60" Power="0.5"/>
        <SteadyState Duration="45" Power="0.901"/>
        <SteadyState Duration="45" Power="1.053"/>
        <SteadyState Duration="45" Power="0.763"/>
        <SteadyState Duration="60" Power="0.5"/>
        <SteadyState Duration="45" Power="0.901"/>
        <SteadyState Duration="45" Power="1.053"/>
        <SteadyState Duration="45" Power="0.763"/>
        <SteadyState Duration="60" Power="0.5"/>
        <SteadyState Duration="45" Power="0.901"/>
        <SteadyState Duration="45" Power="1.053"/>
        <SteadyState Duration="45" Power="0.763"/>
        <SteadyState Duration="180" Power="0.5"/>
        <SteadyState Duration="45" Power="0.901"/>
        <SteadyState Duration="45" Power="1.053"/>
        <SteadyState Duration="45" Power="0.763"/>
        <SteadyState Duration="60" Power="0.5"/>
        <SteadyState Duration="45" Power="0.901"/>
        <SteadyState Duration="45" Power="1.053"/>
        <SteadyState Duration="45" Power="0.763"/>
        <SteadyState Duration="60" Power="0.5"/>
        <SteadyState Duration="45" Power="0.901"/>
        <SteadyState Duration="45" Power="1.053"/>
        <SteadyState Duration="45" Power="0.763"/>
        <SteadyState Duration="60" Power="0.5"/>
        <SteadyState Duration="45" Power="0.901"/>
        <SteadyState Duration="45" Power="1.053"/>
        <SteadyState Duration="45" Power="0.763"/>
        <SteadyState Duration="60" Power="0.5"/>
        <SteadyState Duration="45" Power="0.901"/>
        <SteadyState Duration="45" Power="1.053"/>
        <SteadyState Duration="45" Power="0.763"/>
        <SteadyState Duration="60" Power="0.5"/>
        <Cooldown Duration="270" PowerLow="0.75" PowerHigh="0.25"/>
    </workout>
</workout_file>`
,
`<workout_file>
    <author>Athlima</author>
    <name>Salad</name>
    <category>HIIT</category>
    <description>This workout uses pyramid-structured intervals that gradually build up to your FTP threshold. These efforts enhance your body's capacity to metabolize exercise byproducts—such as lactate and convert them into usable fuel for your cardiovascular system.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <SteadyState Duration="90" Power="0.604"/>
        <SteadyState Duration="90" Power="0.704"/>
        <SteadyState Duration="90" Power="0.814"/>
        <SteadyState Duration="90" Power="0.904"/>
        <SteadyState Duration="60" Power="0.504"/>
        <SteadyState Duration="45" Power="1.054"/>
        <SteadyState Duration="60" Power="0.604"/>
        <SteadyState Duration="45" Power="1.104"/>
        <SteadyState Duration="60" Power="0.554"/>
        <SteadyState Duration="45" Power="1.154"/>
        <SteadyState Duration="60" Power="0.504"/>
        <SteadyState Duration="120" Power="0.654"/>
        <SteadyState Duration="120" Power="0.814"/>
        <SteadyState Duration="120" Power="0.884"/>
        <SteadyState Duration="45" Power="1.004"/>
        <SteadyState Duration="90" Power="0.654"/>
        <SteadyState Duration="45" Power="1.004"/>
        <SteadyState Duration="120" Power="0.884"/>
        <SteadyState Duration="120" Power="0.814"/>
        <SteadyState Duration="120" Power="0.504"/>
        <SteadyState Duration="125" Power="0.814"/>
        <SteadyState Duration="120" Power="0.884"/>
        <SteadyState Duration="45" Power="1.004"/>
        <SteadyState Duration="90" Power="0.654"/>
        <SteadyState Duration="45" Power="1.004"/>
        <SteadyState Duration="120" Power="0.884"/>
        <SteadyState Duration="120" Power="0.814"/>
        <SteadyState Duration="120" Power="0.504"/>
        <Cooldown Duration="280" PowerLow="0.754" PowerHigh="0.504"/>
    </workout>
</workout_file>`
,
`<workout_file>
    <author>Marinov</author>
    <name>Pasta</name>
    <category>Threshold</category>
    <description>A classic 2 times 20 min at almost FTP. Make sure you had some pasta before this session. You will need it!</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="120" PowerLow="0.32" PowerHigh="0.39"/>
        <SteadyState Duration="60" Power="0.39"/>
        <SteadyState Duration="60" Power="0.47"/>
        <SteadyState Duration="60" Power="0.55"/>
        <SteadyState Duration="60" Power="0.63"/>
        <IntervalsT  Repeat="2" OnDuration="30" OffDuration="30" OnPower="1.06" OffPower="0.63"/>
        <SteadyState Duration="120" Power="0.5"/>
        <SteadyState Duration="1200" Power="0.98"/>
        <SteadyState Duration="600" Power="0.44"/>
        <SteadyState Duration="1200" Power="0.98"/>
        <SteadyState Duration="300" Power="0.44"/>
        <Cooldown Duration="300" PowerLow="0.44" PowerHigh="0.32"/>
    </workout>
</workout_file>`
,
`<workout_file>
    <author>Marinov</author>
    <name>Potato Chips +1</name>
    <category>Threshold</category>
    <description>5 by 5 min at 100% of FTP with 5 min recovery in-between. Perfect to get you accustomed to your first intensive sessions after a base block, or just that new FTP value.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <SteadyState Duration="300" Power="0.39"/>
        <SteadyState Duration="120" Power="0.60"/>
        <IntervalsT Repeat="2" OnDuration="30" OffDuration="30" OnPower="0.98" OffPower="0.5"/>
        <SteadyState Duration="120" Power="0.56"/>
        <IntervalsT Repeat="5" OnDuration="300" OffDuration="300" OnPower="1" OffPower="0.5"/>
        <SteadyState Duration="300" Power="0.39"/>
    </workout>
</workout_file>`
,
`<workout_file>
    <author>Marinov</author>
    <name>Potato Chips</name>
    <category>Threshold</category>
    <description>3 by 3 min at 100% of FTP with 3 min recovery in-between. Perfect to get you accustomed to your first intensive sessions after a base block, or just that new FTP value.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <SteadyState Duration="300" Power="0.39"/>
        <SteadyState Duration="120" Power="0.60"/>
        <IntervalsT Repeat="2" OnDuration="30" OffDuration="30" OnPower="0.98" OffPower="0.5"/>
        <SteadyState Duration="120" Power="0.56"/>
        <IntervalsT Repeat="3" OnDuration="180" OffDuration="180" OnPower="1" OffPower="0.5"/>
        <SteadyState Duration="300" Power="0.39"/>
    </workout>
</workout_file>`
,
`<workout_file>
    <author>Marinov</author>
    <name>Maple</name>
    <category>Sweet Spot</category>
    <description>4 times 10 min sweet spot intervals with 5 min recovery in-between and warm-up ramp.</description>
    <sportType>bike</sportType>
    <tags>
        <tag name="sweet"/>
        <tag name="spot"/>
    </tags>
    <workout>
        <Warmup Duration="300" PowerLow="0.32" PowerHigh="0.75"/>
        <IntervalsT Repeat="2" OnDuration="30" OffDuration="30" OnPower="1.08" OffPower="0.44"/>
        <SteadyState Duration="180" Power="0.44"/>
        <IntervalsT Repeat="4" OnDuration="600" OffDuration="300" OnPower="0.92" OffPower="0.44"/>
        <Cooldown Duration="600" PowerLow="0.44" PowerHigh="0.32"/>
    </workout>
</workout_file>`
,
`<workout_file>
    <author>Marinov</author>
    <name>Honey</name>
    <category>Sweet Spot</category>
    <description>3 times 15 min sweet spot intervals with 5 min recovery in-between.</description>
    <sportType>bike</sportType>
    <workout>
        <Warmup Duration="300" PowerLow="0.32" PowerHigh="0.75"/>
        <IntervalsT Repeat="2" OnDuration="30" OffDuration="30" OnPower="1.08" OffPower="0.44"/>
        <SteadyState Duration="180" Power="0.44"/>
        <IntervalsT Repeat="3" OnDuration="900" OffDuration="300" OnPower="0.90" OffPower="0.44"/>
        <Cooldown Duration="600" PowerLow="0.44" PowerHigh="0.32"/>
    </workout>
</workout_file>`
,
`<workout_file>
    <author>Marinov</author>
    <name>Baguette</name>
    <category>Base</category>
    <description>The bread and butter of endurance training with efforts in Zone 1 and 2.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="600" PowerLow="0.32" PowerHigh="0.63"/>
        <SteadyState Duration="600" Power="0.63"/>
        <SteadyState Duration="300" Power="0.56"/>
        <SteadyState Duration="600" Power="0.71"/>
        <SteadyState Duration="300" Power="0.56"/>
        <SteadyState Duration="600" Power="0.71"/>
        <SteadyState Duration="300" Power="0.56"/>
        <SteadyState Duration="600" Power="0.71"/>
        <SteadyState Duration="300" Power="0.56"/>
        <SteadyState Duration="600" Power="0.63"/>
        <Cooldown Duration="600" PowerLow="0.63" PowerHigh="0.32"/>
    </workout>
</workout_file>`
,
`<workout_file>
    <author>Marinov</author>
    <name>Baguette +1</name>
    <category>Base</category>
    <description>The bread and butter of endurance training, with efforts in Zone 2.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <SteadyState Duration="600" Power="0.39"/>
        <SteadyState Duration="600" Power="0.63"/>
        <SteadyState Duration="300" Power="0.56"/>
        <SteadyState Duration="600" Power="0.67"/>
        <SteadyState Duration="300" Power="0.56"/>
        <SteadyState Duration="600" Power="0.71"/>
        <SteadyState Duration="300" Power="0.56"/>
        <SteadyState Duration="600" Power="0.71"/>
        <SteadyState Duration="300" Power="0.56"/>
        <SteadyState Duration="600" Power="0.71"/>
        <SteadyState Duration="300" Power="0.56"/>
        <SteadyState Duration="600" Power="0.67"/>
        <SteadyState Duration="300" Power="0.56"/>
        <SteadyState Duration="600" Power="0.63"/>
        <SteadyState Duration="600" Power="0.39"/>
    </workout>
</workout_file>`
,
`<workout_file>
    <author>Athlima</author>
    <name>Salmon</name>
    <category>Base</category>
    <subcategory></subcategory>
    <description>The fat max workout to push your aerobic base up.</description>
    <sporttype>bike</sporttype>
    <tags></tags>
    <workout>
        <SteadyState Duration="600" Power="0.43" />
        <SteadyState Duration="600" Power="0.51" />
        <SteadyState Duration="600" Power="0.56" />
        <SteadyState Duration="600" Power="0.6" />
        <SteadyState Duration="2400" Power="0.63" />
        <SteadyState Duration="600" Power="0.43" />
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Salmon +1</name>
    <category>Base</category>
    <subcategory></subcategory>
    <description>The fat max workout to push your aerobic base up.</description>
    <sporttype>bike</sporttype>
    <tags></tags>
    <workout>
        <SteadyState Duration="600" Power="0.43" />
        <SteadyState Duration="600" Power="0.51" />
        <SteadyState Duration="600" Power="0.56" />
        <SteadyState Duration="600" Power="0.6" />
        <SteadyState Duration="3600" Power="0.63" />
        <SteadyState Duration="600" Power="0.56" />
        <SteadyState Duration="600" Power="0.43" />
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Blackcurrant</name>
    <category>Recovery</category>
    <description>A recovery ride in zone 1 at 50% of FTP.</description>
    <sporttype>bike</sporttype>
    <tags></tags>
    <workout>
        <Warmup Duration="600" PowerLow="0.30" PowerHigh="0.5"/>
        <SteadyState Duration="2400" Power="0.5"/>
        <Cooldown Duration="600" PowerLow="0.5" PowerHigh="0.30"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>5-1-5 Moxy Test</name>
    <category>Test</category>
    <subcategory>Moxy 515</subcategory>
    <description>This Assessment identifies an athlete's physiological limiters using muscle oxygen sensors through a series of 5 minute work intervals followed by 1 minute rests. It's important to not warm-up before the test. You should not cycle during the rest intervals, since they are meant to track SmO2 and THb recovery rate. You are meant to fail in any of the last 3 steps. Use the Moxy Academy course for guidence on how to analyze. Muscle Oxygen Zone Assessment: https://moxy-academy.teachable.com/courses/209052/lectures/3480785.
</description>
    <sporttype>bike</sporttype>
    <tags></tags>
    <workout>
        <SteadyState Duration="300" Power="0.44" />
        <SteadyState Duration="60" Power="0" />
        <SteadyState Duration="300" Power="0.44" />
        <SteadyState Duration="60" Power="0" />
        <SteadyState Duration="300" Power="0.66" />
        <SteadyState Duration="60" Power="0" />
        <SteadyState Duration="300" Power="0.66" />
        <SteadyState Duration="60" Power="0" />
        <SteadyState Duration="300" Power="0.88" />
        <SteadyState Duration="60" Power="0" />
        <SteadyState Duration="300" Power="0.88" />
        <SteadyState Duration="60" Power="0" />
        <SteadyState Duration="300" Power="1.1" />
        <SteadyState Duration="60" Power="0" />
        <SteadyState Duration="300" Power="1.1" />
        <SteadyState Duration="60" Power="0" />
        <SteadyState Duration="300" Power="1.32" />
        <SteadyState Duration="60" Power="0" />
        <SteadyState Duration="300" Power="1.32" />
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Ramp Test</name>
    <category>Test</category>
    <subcategory>Power Ramp</subcategory>
    <description>Ramp test proceeding in steps of 6% of previous FTP for 60 seconds. Do until exhaustion and take 75% of the power you did in the last interval you’ve reached. That's your new FTP.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <SteadyState Duration=" 300" Power="0.46" />
        <SteadyState Duration="60" Power="0.52" />
        <SteadyState Duration="60" Power="0.58" />
        <SteadyState Duration="60" Power="0.64" />
        <SteadyState Duration="60" Power="0.70" />
        <SteadyState Duration="60" Power="0.76" />
        <SteadyState Duration="60" Power="0.82" />
        <SteadyState Duration="60" Power="0.88" />
        <SteadyState Duration="60" Power="0.94" />
        <SteadyState Duration="60" Power="1.0" />
        <SteadyState Duration="60" Power="1.06" />
        <SteadyState Duration="60" Power="1.12" />
        <SteadyState Duration="60" Power="1.18" />
        <SteadyState Duration="60" Power="1.24" />
        <SteadyState Duration="60" Power="1.3" />
        <SteadyState Duration="60" Power="1.36" />
        <SteadyState Duration="60" Power="1.42" />
        <SteadyState Duration="60" Power="1.48" />
        <SteadyState Duration="60" Power="1.54" />
        <SteadyState Duration="60" Power="1.6" />
        <SteadyState Duration="60" Power="1.66" />
        <SteadyState Duration="60" Power="1.72" />
        <SteadyState Duration="60" Power="1.78" />
        <SteadyState Duration="60" Power="1.84" />
        <SteadyState Duration="60" Power="1.9" />
        <SteadyState Duration="60" Power="1.96" />
        <SteadyState Duration="60" Power="2.02" />
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>2x20 Threshold</name>
    <category>Threshold</category>
    <description>The classic FTP builder: two 20 minute blocks at 96% of FTP with 8 minutes easy between. Settle into a steady, controlled rhythm rather than starting hard.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.75"/>
        <SteadyState Duration="180" Power="0.6"/>
        <IntervalsT Repeat="3" OnDuration="30" OffDuration="60" OnPower="1.05" OffPower="0.5"/>
        <SteadyState Duration="180" Power="0.55"/>
        <SteadyState Duration="1200" Power="0.96"/>
        <SteadyState Duration="480" Power="0.5"/>
        <SteadyState Duration="1200" Power="0.96"/>
        <Cooldown Duration="600" PowerLow="0.6" PowerHigh="0.4"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Over-Unders</name>
    <category>Threshold</category>
    <description>Three sets alternating 2 minutes just above FTP (105%) with 2 minutes just below (88%). Teaches you to recover while still riding hard, like surges in a race. 6 minutes easy between sets.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.75"/>
        <SteadyState Duration="180" Power="0.6"/>
        <IntervalsT Repeat="3" OnDuration="30" OffDuration="60" OnPower="1.05" OffPower="0.5"/>
        <SteadyState Duration="180" Power="0.55"/>
        <IntervalsT Repeat="3" OnDuration="120" OffDuration="120" OnPower="1.05" OffPower="0.88"/>
        <SteadyState Duration="360" Power="0.5"/>
        <IntervalsT Repeat="3" OnDuration="120" OffDuration="120" OnPower="1.05" OffPower="0.88"/>
        <SteadyState Duration="360" Power="0.5"/>
        <IntervalsT Repeat="3" OnDuration="120" OffDuration="120" OnPower="1.05" OffPower="0.88"/>
        <Cooldown Duration="600" PowerLow="0.6" PowerHigh="0.4"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Sweet Spot 3x15</name>
    <category>Sweet Spot</category>
    <description>Three 15 minute blocks at 90% of FTP with 5 minutes easy between. A lot of aerobic work for moderate fatigue; a staple for time-crunched riders.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.75"/>
        <SteadyState Duration="180" Power="0.6"/>
        <SteadyState Duration="900" Power="0.9"/>
        <SteadyState Duration="300" Power="0.5"/>
        <SteadyState Duration="900" Power="0.9"/>
        <SteadyState Duration="300" Power="0.5"/>
        <SteadyState Duration="900" Power="0.9"/>
        <Cooldown Duration="600" PowerLow="0.6" PowerHigh="0.4"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Tempo 2x30</name>
    <category>Tempo</category>
    <description>Two 30 minute blocks at 82% of FTP with 10 minutes easy between. Builds fatigue resistance for long rides and events. Comfortably hard: you can still speak in short sentences.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.75"/>
        <SteadyState Duration="180" Power="0.6"/>
        <SteadyState Duration="1800" Power="0.82"/>
        <SteadyState Duration="600" Power="0.55"/>
        <SteadyState Duration="1800" Power="0.82"/>
        <Cooldown Duration="600" PowerLow="0.6" PowerHigh="0.4"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>VO2 Max 5x5</name>
    <category>VO2 Max</category>
    <description>Five 5 minute efforts at 112% of FTP with 5 minutes easy between. Raises your aerobic ceiling. Pace the first rep so you can match it on the last.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.75"/>
        <SteadyState Duration="180" Power="0.6"/>
        <IntervalsT Repeat="3" OnDuration="30" OffDuration="60" OnPower="1.05" OffPower="0.5"/>
        <SteadyState Duration="180" Power="0.55"/>
        <SteadyState Duration="300" Power="1.12"/>
        <SteadyState Duration="300" Power="0.5"/>
        <SteadyState Duration="300" Power="1.12"/>
        <SteadyState Duration="300" Power="0.5"/>
        <SteadyState Duration="300" Power="1.12"/>
        <SteadyState Duration="300" Power="0.5"/>
        <SteadyState Duration="300" Power="1.12"/>
        <SteadyState Duration="300" Power="0.5"/>
        <SteadyState Duration="300" Power="1.12"/>
        <Cooldown Duration="600" PowerLow="0.6" PowerHigh="0.4"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Seiler 4x8</name>
    <category>VO2 Max</category>
    <description>Four 8 minute efforts at 105% of FTP with 4 minutes easy between, based on research by Stephen Seiler showing longer high-intensity intervals are very effective. Hard but sustainable for all four reps.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.75"/>
        <SteadyState Duration="180" Power="0.6"/>
        <IntervalsT Repeat="3" OnDuration="30" OffDuration="60" OnPower="1.05" OffPower="0.5"/>
        <SteadyState Duration="180" Power="0.55"/>
        <SteadyState Duration="480" Power="1.05"/>
        <SteadyState Duration="240" Power="0.5"/>
        <SteadyState Duration="480" Power="1.05"/>
        <SteadyState Duration="240" Power="0.5"/>
        <SteadyState Duration="480" Power="1.05"/>
        <SteadyState Duration="240" Power="0.5"/>
        <SteadyState Duration="480" Power="1.05"/>
        <Cooldown Duration="600" PowerLow="0.6" PowerHigh="0.4"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Billat 30/30</name>
    <category>VO2 Max</category>
    <description>Three sets of 10 x 30 seconds at 130% of FTP with 30 seconds easy. Short on/off intervals, after Veronique Billat, keep oxygen uptake high for a long time. 5 minutes easy between sets.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.75"/>
        <SteadyState Duration="180" Power="0.6"/>
        <IntervalsT Repeat="3" OnDuration="30" OffDuration="60" OnPower="1.05" OffPower="0.5"/>
        <SteadyState Duration="180" Power="0.55"/>
        <IntervalsT Repeat="10" OnDuration="30" OffDuration="30" OnPower="1.3" OffPower="0.5"/>
        <SteadyState Duration="300" Power="0.5"/>
        <IntervalsT Repeat="10" OnDuration="30" OffDuration="30" OnPower="1.3" OffPower="0.5"/>
        <SteadyState Duration="300" Power="0.5"/>
        <IntervalsT Repeat="10" OnDuration="30" OffDuration="30" OnPower="1.3" OffPower="0.5"/>
        <Cooldown Duration="600" PowerLow="0.6" PowerHigh="0.4"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Ronnestad 30/15</name>
    <category>VO2 Max</category>
    <description>Three sets of 13 x 30 seconds at 125% of FTP with 15 seconds easy, based on research by Bent Ronnestad. The short recoveries make this one of the most demanding VO2 max sessions. 3 minutes easy between sets.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.75"/>
        <SteadyState Duration="180" Power="0.6"/>
        <IntervalsT Repeat="3" OnDuration="30" OffDuration="60" OnPower="1.05" OffPower="0.5"/>
        <SteadyState Duration="180" Power="0.55"/>
        <IntervalsT Repeat="13" OnDuration="30" OffDuration="15" OnPower="1.25" OffPower="0.5"/>
        <SteadyState Duration="180" Power="0.5"/>
        <IntervalsT Repeat="13" OnDuration="30" OffDuration="15" OnPower="1.25" OffPower="0.5"/>
        <SteadyState Duration="180" Power="0.5"/>
        <IntervalsT Repeat="13" OnDuration="30" OffDuration="15" OnPower="1.25" OffPower="0.5"/>
        <Cooldown Duration="600" PowerLow="0.6" PowerHigh="0.4"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Tabata</name>
    <category>HIIT</category>
    <description>Two sets of 8 x 20 seconds very hard (170% of FTP) with 10 seconds easy. Short and brutal anaerobic work; 5 minutes easy between sets. Only for well-rested legs.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.75"/>
        <SteadyState Duration="180" Power="0.6"/>
        <IntervalsT Repeat="3" OnDuration="30" OffDuration="60" OnPower="1.05" OffPower="0.5"/>
        <SteadyState Duration="180" Power="0.55"/>
        <IntervalsT Repeat="8" OnDuration="20" OffDuration="10" OnPower="1.7" OffPower="0.45"/>
        <SteadyState Duration="300" Power="0.5"/>
        <IntervalsT Repeat="8" OnDuration="20" OffDuration="10" OnPower="1.7" OffPower="0.45"/>
        <Cooldown Duration="600" PowerLow="0.6" PowerHigh="0.4"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Sprints 8x12s</name>
    <category>Sprint</category>
    <description>Eight all-out 12 second sprints with almost 5 minutes easy between. The sprints are free-ride (no power target): shift up, stand and go full gas. Full recovery keeps every sprint at top quality.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.75"/>
        <SteadyState Duration="180" Power="0.6"/>
        <IntervalsT Repeat="3" OnDuration="30" OffDuration="60" OnPower="1.05" OffPower="0.5"/>
        <SteadyState Duration="180" Power="0.55"/>
        <FreeRide Duration="12"/>
        <SteadyState Duration="288" Power="0.5"/>
        <FreeRide Duration="12"/>
        <SteadyState Duration="288" Power="0.5"/>
        <FreeRide Duration="12"/>
        <SteadyState Duration="288" Power="0.5"/>
        <FreeRide Duration="12"/>
        <SteadyState Duration="288" Power="0.5"/>
        <FreeRide Duration="12"/>
        <SteadyState Duration="288" Power="0.5"/>
        <FreeRide Duration="12"/>
        <SteadyState Duration="288" Power="0.5"/>
        <FreeRide Duration="12"/>
        <SteadyState Duration="288" Power="0.5"/>
        <FreeRide Duration="12"/>
        <Cooldown Duration="600" PowerLow="0.6" PowerHigh="0.4"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Cadence Drills</name>
    <category>Technique</category>
    <description>Five 4 minute blocks at 80% of FTP alternating 1 minute low cadence (60 rpm) and 1 minute high cadence (105 rpm), 3 minutes easy between. Improves pedalling efficiency and strength on the bike.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.75"/>
        <SteadyState Duration="180" Power="0.6"/>
        <IntervalsT Repeat="2" OnDuration="60" OffDuration="60" OnPower="0.8" OffPower="0.8" Cadence="60" CadenceResting="105"/>
        <SteadyState Duration="180" Power="0.55"/>
        <IntervalsT Repeat="2" OnDuration="60" OffDuration="60" OnPower="0.8" OffPower="0.8" Cadence="60" CadenceResting="105"/>
        <SteadyState Duration="180" Power="0.55"/>
        <IntervalsT Repeat="2" OnDuration="60" OffDuration="60" OnPower="0.8" OffPower="0.8" Cadence="60" CadenceResting="105"/>
        <SteadyState Duration="180" Power="0.55"/>
        <IntervalsT Repeat="2" OnDuration="60" OffDuration="60" OnPower="0.8" OffPower="0.8" Cadence="60" CadenceResting="105"/>
        <SteadyState Duration="180" Power="0.55"/>
        <IntervalsT Repeat="2" OnDuration="60" OffDuration="60" OnPower="0.8" OffPower="0.8" Cadence="60" CadenceResting="105"/>
        <Cooldown Duration="600" PowerLow="0.6" PowerHigh="0.4"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Endurance 90</name>
    <category>Base</category>
    <description>90 minutes of steady endurance riding at 65-70% of FTP with a short cadence lift every 15 minutes. The foundation of every training plan: easy enough to chat, long enough to build aerobic fitness.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="300" PowerLow="0.45" PowerHigh="0.65"/>
        <SteadyState Duration="840" Power="0.67"/>
        <SteadyState Duration="60" Power="0.7" Cadence="100"/>
        <SteadyState Duration="840" Power="0.67"/>
        <SteadyState Duration="60" Power="0.7" Cadence="100"/>
        <SteadyState Duration="840" Power="0.67"/>
        <SteadyState Duration="60" Power="0.7" Cadence="100"/>
        <SteadyState Duration="840" Power="0.67"/>
        <SteadyState Duration="60" Power="0.7" Cadence="100"/>
        <SteadyState Duration="1200" Power="0.67"/>
        <Cooldown Duration="300" PowerLow="0.6" PowerHigh="0.45"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Openers</name>
    <category>Race Prep</category>
    <description>A short session for the day before an event: easy riding with three 1 minute efforts at 110% of FTP and three short free-ride sprints. Wakes up the legs without adding fatigue.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.75"/>
        <SteadyState Duration="180" Power="0.6"/>
        <IntervalsT Repeat="3" OnDuration="60" OffDuration="180" OnPower="1.1" OffPower="0.55"/>
        <SteadyState Duration="180" Power="0.6"/>
        <FreeRide Duration="10"/>
        <SteadyState Duration="170" Power="0.5"/>
        <FreeRide Duration="10"/>
        <SteadyState Duration="170" Power="0.5"/>
        <FreeRide Duration="10"/>
        <SteadyState Duration="300" Power="0.55"/>
        <Cooldown Duration="600" PowerLow="0.6" PowerHigh="0.4"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>20 Minute FTP Test</name>
    <category>Test</category>
    <description>The classic field test: warm up, a 5 minute hard effort to clear fresh legs, 10 minutes easy, then 20 minutes as hard as you can sustain. The 20 minute block is free-ride, so pace it yourself. FTP is about 95% of your 20 minute average power.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.75"/>
        <SteadyState Duration="180" Power="0.6"/>
        <IntervalsT Repeat="3" OnDuration="30" OffDuration="60" OnPower="1.05" OffPower="0.5"/>
        <SteadyState Duration="180" Power="0.55"/>
        <SteadyState Duration="300" Power="1.05"/>
        <SteadyState Duration="600" Power="0.5"/>
        <FreeRide Duration="1200"/>
        <Cooldown Duration="600" PowerLow="0.6" PowerHigh="0.4"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Endurance 2h30</name>
    <category>Base</category>
    <description>A steady 2 hour 30 minute aerobic ride: settle into an easy endurance pace, build gently through the middle, and finish with a short controlled lift. Keep it conversational and fuel regularly.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.65"/>
        <SteadyState Duration="2400" Power="0.65"/>
        <SteadyState Duration="2400" Power="0.67"/>
        <SteadyState Duration="2400" Power="0.68"/>
        <SteadyState Duration="600" Power="0.7"/>
        <Cooldown Duration="600" PowerLow="0.6" PowerHigh="0.45"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Endurance 3h</name>
    <category>Base</category>
    <description>A three-hour aerobic foundation ride with long, even endurance blocks and a gentle progression near the end. Stay relaxed, keep the effort conversational, and plan food and fluids before you start.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.65"/>
        <SteadyState Duration="3600" Power="0.65"/>
        <SteadyState Duration="3600" Power="0.67"/>
        <SteadyState Duration="1800" Power="0.68"/>
        <SteadyState Duration="600" Power="0.7"/>
        <Cooldown Duration="600" PowerLow="0.6" PowerHigh="0.45"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Endurance 3h30 Progressive</name>
    <category>Base</category>
    <description>A 3 hour 30 minute endurance ride that gradually builds from easy aerobic riding to a steady finish. Keep every block controlled rather than turning the progression into a threshold effort; fuel regularly throughout.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="900" PowerLow="0.45" PowerHigh="0.65"/>
        <SteadyState Duration="3600" Power="0.64"/>
        <SteadyState Duration="3600" Power="0.66"/>
        <SteadyState Duration="2400" Power="0.68"/>
        <SteadyState Duration="1200" Power="0.7"/>
        <Cooldown Duration="900" PowerLow="0.6" PowerHigh="0.45"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Endurance 4h</name>
    <category>Base</category>
    <description>A four-hour steady endurance ride for experienced riders building long-ride durability. Keep the effort easy and consistent, take advantage of the easier mid-ride block, and fuel and hydrate regularly.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="900" PowerLow="0.45" PowerHigh="0.65"/>
        <SteadyState Duration="3600" Power="0.65"/>
        <SteadyState Duration="3600" Power="0.66"/>
        <SteadyState Duration="3600" Power="0.65"/>
        <SteadyState Duration="1800" Power="0.67"/>
        <Cooldown Duration="900" PowerLow="0.6" PowerHigh="0.45"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Endurance 2h Steady</name>
    <category>Base</category>
    <description>A two-hour aerobic ride with two long, conversational endurance blocks. Keep the effort controlled and fuel and hydrate regularly.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.65"/>
        <SteadyState Duration="3000" Power="0.65"/>
        <SteadyState Duration="3000" Power="0.68"/>
        <Cooldown Duration="600" PowerLow="0.6" PowerHigh="0.45"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Endurance 2h45 Progressive</name>
    <category>Base</category>
    <description>A progressive long aerobic ride, moving from easy endurance to a steady but still conversational finish. Fuel and hydrate regularly; do not turn the final block into a threshold effort.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="900" PowerLow="0.45" PowerHigh="0.65"/>
        <SteadyState Duration="4200" Power="0.64"/>
        <SteadyState Duration="3600" Power="0.67"/>
        <SteadyState Duration="600" Power="0.7"/>
        <Cooldown Duration="600" PowerLow="0.6" PowerHigh="0.45"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Endurance 3h15 Steady</name>
    <category>Base</category>
    <description>A long, steady aerobic ride for riders who already tolerate this duration. Keep the work easy and even, and plan regular food and fluids before starting.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="900" PowerLow="0.45" PowerHigh="0.65"/>
        <SteadyState Duration="4800" Power="0.64"/>
        <SteadyState Duration="4200" Power="0.66"/>
        <SteadyState Duration="1200" Power="0.68"/>
        <Cooldown Duration="600" PowerLow="0.6" PowerHigh="0.45"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Tempo 2x20</name>
    <category>Base</category>
    <description>Two controlled 20-minute tempo blocks at 78-80% of FTP with five minutes easy between. Keep the effort below threshold and conversational in short sentences.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.7"/>
        <IntervalsT Repeat="2" OnDuration="1200" OffDuration="300" OnPower="0.78" OffPower="0.55"/>
        <Cooldown Duration="600" PowerLow="0.6" PowerHigh="0.4"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Sweet Spot 4x8</name>
    <category>Sweet Spot</category>
    <description>Four eight-minute sweet-spot efforts near 90% of FTP with four minutes easy between. A shorter-step progression from longer sweet-spot blocks; keep every effort controlled.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="600" PowerLow="0.4" PowerHigh="0.72"/>
        <IntervalsT Repeat="4" OnDuration="480" OffDuration="240" OnPower="0.9" OffPower="0.5"/>
        <Cooldown Duration="600" PowerLow="0.6" PowerHigh="0.4"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Threshold 3x8</name>
    <category>Threshold</category>
    <description>Three controlled eight-minute threshold efforts at 98% of FTP with four minutes easy between. The Coach may reduce the repetitions to meet the hard-time limit. Keep the effort even; stop or reduce it if the target is no longer sustainable.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="600" PowerLow="0.4" PowerHigh="0.75"/>
        <IntervalsT Repeat="3" OnDuration="480" OffDuration="240" OnPower="0.98" OffPower="0.5"/>
        <Cooldown Duration="600" PowerLow="0.6" PowerHigh="0.4"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>VO2 4x4</name>
    <category>VO2 Max</category>
    <description>Four four-minute high-aerobic efforts, starting around 112% of FTP, with four minutes easy between. This is a demanding session: pace evenly and use only when recovered.</description>
    <sportType>bike</sportType>
    <tags>
    </tags>
    <workout>
        <Warmup Duration="600" PowerLow="0.4" PowerHigh="0.75"/>
        <IntervalsT Repeat="4" OnDuration="240" OffDuration="240" OnPower="1.12" OffPower="0.5"/>
        <Cooldown Duration="600" PowerLow="0.6" PowerHigh="0.4"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Cadence Foundations 30</name>
    <category>Technique</category>
    <description>Practice smooth pedalling with four one-minute lifts to 95 rpm at easy power, each followed by two minutes at 80 rpm. Stay seated and relaxed; return to a comfortable cadence if bouncing or uncomfortable. Stop if you feel pain.</description>
    <sportType>bike</sportType>
    <workout>
        <Warmup Duration="360" PowerLow="0.4" PowerHigh="0.6"/>
        <IntervalsT Repeat="4" OnDuration="60" OffDuration="120" OnPower="0.6" OffPower="0.55" Cadence="95" CadenceResting="80"/>
        <SteadyState Duration="420" Power="0.6"/>
        <Cooldown Duration="300" PowerLow="0.55" PowerHigh="0.4"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Cadence Control 40</name>
    <category>Technique</category>
    <description>Five two-minute controlled spins at 95 rpm alternate with two minutes at 80 rpm, surrounded by easy endurance riding. Stay seated, smooth and relaxed; use a comfortable cadence if needed. Stop if you feel pain.</description>
    <sportType>bike</sportType>
    <workout>
        <Warmup Duration="480" PowerLow="0.4" PowerHigh="0.6"/>
        <IntervalsT Repeat="5" OnDuration="120" OffDuration="120" OnPower="0.6" OffPower="0.55" Cadence="95" CadenceResting="80"/>
        <SteadyState Duration="420" Power="0.6"/>
        <Cooldown Duration="300" PowerLow="0.55" PowerHigh="0.4"/>
    </workout>
</workout_file>`,
`<workout_file>
    <author>Athlima</author>
    <name>Cadence Endurance 50</name>
    <category>Technique</category>
    <description>Six easy two-minute spins at 100 rpm with two minutes at 85 rpm, followed by steady endurance riding. Keep your upper body quiet; use a comfortable cadence if you bounce or feel discomfort. Stop if you feel pain.</description>
    <sportType>bike</sportType>
    <workout>
        <Warmup Duration="600" PowerLow="0.4" PowerHigh="0.6"/>
        <IntervalsT Repeat="6" OnDuration="120" OffDuration="120" OnPower="0.6" OffPower="0.55" Cadence="100" CadenceResting="85"/>
        <SteadyState Duration="600" Power="0.65"/>
        <Cooldown Duration="360" PowerLow="0.55" PowerHigh="0.4"/>
    </workout>
</workout_file>`,
];

export { workouts };
