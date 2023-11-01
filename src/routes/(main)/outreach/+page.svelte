<script lang="ts">
  import config from '../../../config';
  import Image from 'svimg';
</script>

<div class="p-4 m-4">
  <div class="mt-6 justify-center align-middle flex">
    <h2 class="h2">{config.information.outreach.hero}</h2>
  </div>
  <br />
  <div class="card p-4 m-2 grid-cols-1 md:grid-cols-2 grid gap-4">
    <div>
      <Image
        src="/photos/outreach2.jpg"
        class="bg-black/50 w-full aspect-[21/9] object-cover rounded-xl"
        alt="Post"
      />
    </div>
    <div>
      <h1 class="h1">Outreach</h1>
      <br />
      <p class="text-lg text-center">
        At the Robotics Club of Central Florida, outreach is at the heart of our mission. We believe
        in the power of robotics to inspire, educate, and shape the future. Through our outreach
        initiatives, we actively engage with our local community and schools, organizing hands-on
        workshops, demonstrations, and educational events that introduce young minds to the wonders
        of STEM and robotics. We are dedicated to fostering a love for technology and innovation in
        the next generation, helping them envision a future where they, too, can make a difference
        in the world of robotics. Join us as we reach out and share our passion, knowledge, and
        enthusiasm with the world!
        <br />
        <br />
        Our outreach efforts extend to collaborating with other organizations, participating in community
        events, and offering mentorship programs. We're committed to fostering connections and ensuring
        that the benefits of robotics are accessible to everyone.
      </p>
    </div>
    <div>
      <h1 class="h1">Commitment</h1>
      <br />
      <p class="text-lg text-center">
        Participate in our outreach programs to boost your problem-solving, teamwork, and critical
        thinking skills while connecting with a dynamic community of innovators. Explore the
        exciting world of robotics and shape the future of technology. Get involved and thrive
        through robotics. Join us in our mission to inspire and educate through robotics outreach!
        Together, we can make a positive impact on the future of technology and innovation
        <br />
      </p>
      <hr />
      <a
        class="justify-center align-middle flex variant-ghost-secondary hover:variant-filled-secondary btn"
        href="/contact">Get in Touch</a
      >
    </div>
    <div>
      <Image
        src="/photos/outreach3.png"
        class="bg-black/50 w-full aspect-[21/9] object-cover rounded-xl"
        alt="Post"
      />
    </div>
  </div>
</div>
