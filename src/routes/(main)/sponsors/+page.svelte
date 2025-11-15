<script lang="ts">
  import { injectDots } from '../../../components/pixijs/dotsAnimation';
  import { onMount } from 'svelte';
  import { modeCurrent } from '@skeletonlabs/skeleton';

  let mainEle: HTMLElement;
  onMount(() => {
    injectDots(mainEle, 200);
  });
    // Image link to load
    let imageUrl = "https://lh3.googleusercontent.com/pw/AP1GczPgwQIAh4n8CAPbGOEQod39G73J6kmg1OxO5RKxnOEdcULy52h5DdDLxmE9vTKLfO7tYJGCQIV-E7TramY7eH_VvlgA1nX4MdcN5zJanqqBzauTUsY=w2400";
</script>

<!-- Brandons Scroller -->

<div>
  <div class="h1" style="font-size: 9vh; line-height: 5rem; text-align: center; padding: 3%;">
    <!-- scroller title -->
    <b>TOP SPONSORS</b>
  </div>
<!--  -->
  <div class="scroller-container">
    <div class="scroller-inner">
      <img src="/photos/RetengaxTransparent.png" alt="Retengax" width="70px" />
      <div class="content-item">Retengax <br /></div>
      <img src = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQcI8iitb1xCWitrAjcMgtqmkQrGi0aAY9xpf48RKL-O_1GzCPqo5zEkzoOz6CB-GI3wA4&usqp=CAU" alt = "Go Engineer"  width = "70px">
      <div class="content-item">Go Engineer <br /></div>
      <img src = "https://static.wixstatic.com/media/7cdbae_45341b034ab7454fa06333ed8df1fbf8~mv2.png" alt = "Orlando Recycles"  width = "70px">
      <div class="content-item">Orlando Recycles <br /></div>
      <img src = "/photos/ProtocaseTransparent.png" alt = "Protocase"  width = "70px">
      <div class="content-item">Protocase <br /></div>
      <img src = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRwvvA5u034vT8SJmEZwe6QS17C5qTCZqmYqA&s" alt = "UCF CECS"  width = "70px">
      <div class="content-item">UCF CECS <br /></div>
      <img src="/photos/RetengaxTransparent.png" alt="Retengax" width="70px" />
      <div class="content-item">Retengax <br /></div>
      <img src = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQcI8iitb1xCWitrAjcMgtqmkQrGi0aAY9xpf48RKL-O_1GzCPqo5zEkzoOz6CB-GI3wA4&usqp=CAU" alt = "Go Engineer"  width = "70px">
      <div class="content-item">Go Engineer <br /></div>
      <img src = "https://static.wixstatic.com/media/7cdbae_45341b034ab7454fa06333ed8df1fbf8~mv2.png" alt = "Orlando Recycles"  width = "70px">
      <div class="content-item">Orlando Recycles <br /></div>
      <img src = "/photos/ProtocaseTransparent.png" alt = "Protocase"  width = "70px">
      <div class="content-item">Protocase <br /></div>
      <img src = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRwvvA5u034vT8SJmEZwe6QS17C5qTCZqmYqA&s" alt = "UCF CECS"  width = "70px">
      <div class="content-item">UCF CECS <br /></div>
      <img src="/photos/RetengaxTransparent.png" alt="Retengax" width="70px" />
      <div class="content-item">Retengax <br /></div>
      <img src = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQcI8iitb1xCWitrAjcMgtqmkQrGi0aAY9xpf48RKL-O_1GzCPqo5zEkzoOz6CB-GI3wA4&usqp=CAU" alt = "Go Engineer"  width = "70px">
      <div class="content-item">Go Engineer <br /></div>
      <img src = "https://static.wixstatic.com/media/7cdbae_45341b034ab7454fa06333ed8df1fbf8~mv2.png" alt = "Orlando Recycles"  width = "70px">
      <div class="content-item">Orlando Recycles <br /></div>
      <img src = "/photos/ProtocaseTransparent.png" alt = "Protocase"  width = "70px">
      <div class="content-item">Protocase <br /></div>
      <img src = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRwvvA5u034vT8SJmEZwe6QS17C5qTCZqmYqA&s" alt = "UCF CECS"  width = "70px">
      <div class="content-item">UCF CECS <br /></div>

    </div>
  </div>
</div>

<!-- Kits Sponsorship Tiers -->
<div bind:this={mainEle} class="absolute top-0 left-0 right-0 bottom-0 pointer-events-auto -z-20" />
<div
  class="h-screen grid place-items-center w-screen top-0 pointer-events-none"
  style="margin-top:50px; padding-bottom: 130px;"
>
  <div
    class={$modeCurrent
      ? 'block card p-8 pointer-events-auto shadow-xl shadow-surface-300'
      : 'block card p-8 pointer-events-auto shadow-xl shadow-surface-500'}
  >
    <div class="m-4 centered" style="margin-top: rem">
      <div class="sponsorContainer sponsor-wrapper">
        <div class="centered">
          <div class="h1" style="font-size: 5vh; line-height: 5rem;">
            <b>SPONSORSHIP TIERS</b>
          </div>
          <br />
          <div class="sponsorshipTiers">
            <div class="processorPatron">
              <div>PROCESSOR PATRON</div>
              <div>$5,000+</div>
            </div>
            <ul class="tierInfo">
              <li>Acknowledgments in social media posts</li>
              <li>Logo on club promotional materials for community events</li>
              <li>+ Circuit Supporter</li>
              <p>Current Supporters:</p>
              <div class="currentSupporters">
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
              </div>
            </ul>
            <div class="circuitSupporter">
              <div>CIRCUIT SUPPORTER</div>
              <div>UP TO $3,000</div>
            </div>
            <ul class="tierInfo">
              <li>Logo on club T-shirts *</li>
              <li>Logo on multiple robots/projects of choice</li>
              <li>+ Bolt Backer</li>
              <p>Current Supporters:</p>
              <div class="currentSupporters">
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
              </div>
            </ul>
            <div class="boltBacker">
              <div>BOLT BACKER</div>
              <div>UP TO $1,000</div>
            </div>
            <ul class="tierInfo">
              <li>Logo on single robot/project of choice **</li>
              <li>+ Aluminum Ally</li>
              <p>Current Supporters:</p>
              <div class="currentSupporters">
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
              </div>
            </ul>
            <div class="aluminumAlly">
              <div>ALUMINUM ALLY</div>
              <div>$250</div>
            </div>
            <ul class="tierInfo">
              <li>Appearance on club website sponsors page</li>
              <li>Logo/Infographic in club workspace *</li>
              <li>Member made sponsorship gift</li>
              <p>Current Supporters:</p>
              <div class="currentSupporters">
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="">
                    <img src="/photos/PlaceHolderImg.png" alt="Discord" />
                  </a>
                </div>
              </div>
            </ul>
          </div>
        </div>
      </div>

      <hr style="border: 1px solid" />
      <div class="sponsorInfo">
        <br />* Logo size determined by donation ammount
        <br />
        <br />** Robot(s)/project(s) must be selected at the time of donation
        <br />
        <br />NOTE: Your sponsorship is tax-deductible and we'll provide a recipt for your records.
        <br />
        <br /> Become a sponsor by reaching out to
        <a href="mailto:outreach@rccf.club" class="text-blue-500 underline">outreach@rccf.club</a>
      </div>
    </div>
  </div>
</div>

<style>
  .centered {
    max-width: none;
    width: auto;
    height: auto;
    margin-top: 3rem;

    margin-bottom: 2rem;
    margin: 0 auto;
    position: relative;
    text-align: center;
    animation: fadeIn 3s;
  }

  .sponsor-wrapper {
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: flex;
  }

  .sponsorContainer {
    display: flex;
    flex-direction: row;
    position: relative;
    justify-content: center;
    align-items: stretch;
    flex-wrap: nowrap;
    min-width: 0;
    width: 80vw;
    height: 100%;
  }


  .sponsorshipTiers {
    font-size: 200%;
    line-height: 5rem;
    font-family: var(--theme-font-family-heading);
  }

  .tierInfo {
    line-height: 4rem;
    font-family: var(--theme-font-family-heading);
    text-align: left;
    list-style-type: disc;
    margin-left: 10px;
    gap: 50px;
    padding-left: 50px;
    padding-top: 20px;
    padding-bottom: 20px;
    font-size: 85%;
  }

  .processorPatron {
    background-color: #d1a504;
    border-radius: 10px;
    width: 100%;
    text-align: left;
    padding-left: 25px;
    padding-right: 25px;
    margin-left: 10px;
    color: white;
    display: flex;
    justify-content: space-between;
    max-width: 96%;
    flex-wrap: wrap;
    word-wrap: break-word;
  }

  .circuitSupporter {
    background-color: #9f7e08;
    border-radius: 10px;
    width: 100%;
    text-align: left;
    padding-left: 25px;
    padding-right: 25px;
    margin-left: 10px;
    color: white;
    display: flex;
    justify-content: space-between;
    max-width: 85%;
    flex-wrap: wrap;
    word-wrap: break-word;
  }

  .boltBacker {
    background-color: #6f590a;
    border-radius: 10px;
    width: 100%;
    text-align: left;
    padding-left: 25px;
    padding-right: 25px;
    margin-left: 10px;
    color: white;
    display: flex;
    justify-content: space-between;
    max-width: 70%;
    flex-wrap: wrap;
    word-wrap: break-word;
  }

  .aluminumAlly {
    background-color: #3f340c;
    border-radius: 10px;
    width: 100%;
    text-align: left;
    padding-left: 25px;
    padding-right: 25px;
    margin-left: 10px;
    color: white;
    display: flex;
    justify-content: space-between;
    max-width: 55%;
    flex-wrap: wrap;
    word-wrap: break-word;
  }

  .sponsorInfo {
    font-size: 150%;
    line-height: 3rem;
    font-family: var(--theme-font-family-heading);
  }

  .currentSupporters {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 10px;
  }

  .sponsor-logo {
    display: flex;
    align-items: center;
    gap: 15px;
    margin-bottom: 15px;
    object-fit: contain;
  }

  .sponsor-logo img {
    width: 100px;
    height: 100px;
    object-fit: contain;
    border-radius: 0 !important;
  }

  .scroller-container {
    width: 100%;
    overflow: hidden;
    font-size: 30pt;
    height: 90px;
    border-top: solid;
    border-bottom: solid;
    background-color: rgb(32, 32, 32);
  }

  .scroller-inner {
    padding-top: 25px;
    display: flex;
    white-space: pre-wrap;
    width: max-content;
    animation: scrollLeft 15s linear infinite;
    font-family: var(--theme-font-family-heading);
    gap: 10px;
  }

  .scroller-inner img {
    margin-top: -18px;
  }

  @keyframes scrollLeft {
    from {
      transform: translateX(0%);
    }
    to {
      transform: translateX(-33.5%);
    }
  }

  @keyframes enterScreen {
    from {
      opacity: 0%;
    }
    to {
      opacity: 100%;
    }
  } 
   /*   
    .sponsorContainer > div {
        display: flex;
    }

  .sideBox{
        background-color: #ffc904;
        width: 75px;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-self: stretch;
    }

  .sideBox img {
    padding-bottom: 10px;
    margin-top: auto;
    scale: 0.75;
  } */

    img {
        max-width: 100%;
        height: auto;
        display: block;
        margin: 0 auto;
    }
</style>
  
<main>
    <!-- svelte-ignore a11y-img-redundant-alt -->
    <img src={imageUrl} alt="Image description" />
    <!-- svelte-ignore a11y-img-redundant-alt -->
    <img src={"https://lh3.googleusercontent.com/pw/AP1GczPo2li6sb8MSLo-TzvYzTaYorf_o8ogywvmAE3uo3bsTTK_UHZI7PFhDbZUrJnv1AhN0xVARAPEEg4Z_UbBigzPYObemFC9OPMfLJs6VzK71FlbLn0=w2400"} alt="Image description" />
    <!-- svelte-ignore a11y-img-redundant-alt -->
    <img src={"https://lh3.googleusercontent.com/pw/AP1GczNUJ2rVGh-LyeWqjex65MdtxVo6-HJ_kQs1kfIJwbbKoyd0t6HqrxvCVa6xTo2OX53ZrA2jl9iU2nspKhKp_2LvGH9kYztHstPrz-iBHl_PnWtrHc8=w2400"} alt="Image description" />
        <h1><br></h1>
    <!-- svelte-ignore a11y-img-redundant-alt -->
    <img src={"https://lh3.googleusercontent.com/pw/AP1GczMi_pH21kxBUCqEuqio8A-tphN2IhuVgJ5EfjtL_RwNLfs8ln1dyg06d5I0kRWASOAtPJgpZ8T5jR-G29sjqY7wHfRmJE2E2_0UC_MzMvm3AaG1eSI=w2400"} alt="Image description" />

</main>
  