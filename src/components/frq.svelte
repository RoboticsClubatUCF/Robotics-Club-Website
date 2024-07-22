<script>
    import { Accordion, AccordionItem } from "@skeletonlabs/skeleton";
</script>

<div style="margin-top: 2rem">
    <Accordion class="card" style="margin-top: 2rem">
        <AccordionItem>
            <svelte:fragment slot="summary"><strong>Do I need experience to join?</strong></svelte:fragment>
            <svelte:fragment slot="content">No, all projects are drop-in certified, so no skills or experience are required for you to join a project! It is, however, required that you become a member before participating in any projects.</svelte:fragment>
        </AccordionItem>
        <AccordionItem>
            <svelte:fragment slot="summary"><strong>How much is membership?</strong></svelte:fragment>
            <svelte:fragment slot="content">Membership is $25 a semester and $50 a year. There will be times in which the lab is open during the summer and during those times membership is completely free!</svelte:fragment>
        </AccordionItem>
        <AccordionItem>
            <svelte:fragment slot="summary"><strong>How do I become a member?</strong></svelte:fragment>
            <svelte:fragment slot="content">
                Becoming a member is as easy as:
                <ol>
                    <li>1. Create an RCCF web account by going to sign in -> become a member</li>
                    <li>2. Fill out your members' survey and pay dues</li>
                    <li>3. Join a general body meeting (times posted on <a href="https://discord.gg/m8XZahpNjR" target="_blank" style="color: blue; text-decoration: underline;">Discord</a>)</li>
                </ol>
            </svelte:fragment>
        </AccordionItem>
        <AccordionItem>
            <svelte:fragment slot="summary"><strong>Can I create my own project?</strong></svelte:fragment>
            <svelte:fragment slot="content">It depends, the approval or denial of a project depends on the number of people interested, the allowed budget, and general approval from administration. If you truly want to start your own project within RCCF start by talking to Crystal or the president.</svelte:fragment>
        </AccordionItem>
        <AccordionItem>
            <svelte:fragment slot="summary"><strong>Can I pay for something to be 3D printed?</strong></svelte:fragment>
            <svelte:fragment slot="content">Yes! Price will vary depending on the size and in-fill of the print. Other than that just make sure you ask early on as we have a lot of projects that require 3D printing and those come first.</svelte:fragment>
        </AccordionItem>
        <AccordionItem>
            <svelte:fragment slot="summary"><strong>Where is the lab located?</strong></svelte:fragment>
            <svelte:fragment slot="content">We are located in UCF’s Institute For Simulation & Training at <a href="https://maps.app.goo.gl/rzwvL5BvsXfBURs96" target="_blank" style="color: blue; text-decoration: underline;">3100 Technology Pkwy, Orlando, FL 32826</a>. If you have trouble finding us you can find an aerial map guide <a href="https://photos.app.goo.gl/QNiuUQVKTHywd94x8" target="_blank" style="color: blue; text-decoration: underline;">Here</a>.</svelte:fragment>
        </AccordionItem>
        <AccordionItem>
            <svelte:fragment slot="summary"><strong>How do I join a project?</strong></svelte:fragment>
            <svelte:fragment slot="content">Joining a project is easy. Once you’ve become a member and paid your dues head over to the discord and in bot-cmds type in /teams to pull up all the projects and then all you have to do is pick the ones you want to join. Of course, show up to the meetings as well.</svelte:fragment>
        </AccordionItem>
        <AccordionItem>
            <svelte:fragment slot="summary"><strong>How do sponsorships work?</strong></svelte:fragment>
            <svelte:fragment slot="content">If you would like to sponsor us check out what we offer in our <a href="/sponsor" style="color: blue; text-decoration: underline;">sponsors’ page</a>, otherwise it’s basically a way to financially support RCCF and its mission.</svelte:fragment>
        </AccordionItem>
        <!-- more questions -->
    </Accordion>
</div>
