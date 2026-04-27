<script lang="ts">
  import { injectDots } from '../../../components/pixijs/dotsAnimation';
  import { onMount } from 'svelte';
  import { modeCurrent } from '@skeletonlabs/skeleton';

  let mainEle: HTMLElement;
  let dotsInjected = false;

  function updateDots() {
    if (!mainEle) return;

    if (!$modeCurrent && !dotsInjected) {
      injectDots(mainEle, 200);
      dotsInjected = true;
    }
    else if (dotsInjected) {
      const canvas = mainEle.querySelector('canvas');
      if (canvas) {
        canvas.remove();
        dotsInjected = false;
      }
    }
  }

  $: $modeCurrent, mainEle && updateDots();

    // Image link to load
    let imageUrl = "https://lh3.googleusercontent.com/pw/AP1GczPgwQIAh4n8CAPbGOEQod39G73J6kmg1OxO5RKxnOEdcULy52h5DdDLxmE9vTKLfO7tYJGCQIV-E7TramY7eH_VvlgA1nX4MdcN5zJanqqBzauTUsY=w2400";
</script>

<div class="sponsors-page">

<!-- Brandons Scroller -->
<div>
  <div class="h1 text-[5rem] leading-[5rem] text-center p-[3%]">
    <!-- scroller title -->
    <b>TOP SPONSORS</b>
  </div>
<!--  -->
  <div class="scroller-container">
    <div class="scroller-inner">
      <img src="https://lh3.googleusercontent.com/pw/AP1GczOGcEn1Ztbwkhrfkyb6yuhgUvByGfARYW5qJo1iBRDfefpX-fUJWo4DDATe0fBL_UhrGpDTHt72Hg9rUZntqHPWG44bAaOkBBQLNuGnUw-VEtkC0IrizoG_3QHCTrrIcsaR8RJ53w3UoW7PsYvZwO16=w192-h192-s-no-gm?authuser=0" alt="Retengax" width="70px" />
      <div class="content-item">Retengax <br /></div>
      <img src = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQcI8iitb1xCWitrAjcMgtqmkQrGi0aAY9xpf48RKL-O_1GzCPqo5zEkzoOz6CB-GI3wA4&usqp=CAU" alt = "Go Engineer"  width = "70px">
      <div class="content-item">Go Engineer <br /></div>
      <img src = "https://static.wixstatic.com/media/7cdbae_45341b034ab7454fa06333ed8df1fbf8~mv2.png" alt = "Orlando Recycles"  width = "70px">
      <div class="content-item">Orlando Recycles <br /></div>
      <img src = "https://lh3.googleusercontent.com/pw/AP1GczP4LH7ppxLX_QYV_ciUL4052712OmUTUlrC83gwEWenPesQSV5QxB9g94t-4i4wKz9dY7vLJD6zQ9EZ3cW_am3cF70UWLEWWtzOnBSzmksyW8a_m8y8JQaxXR9BTmNUEOLb9LkdnPouzm12eDbQpK-h=w131-h133-s-no-gm?authuser=0" alt = "Protocase"  width = "70px">
      <div class="content-item">Protocase <br /></div>
      <img src = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRwvvA5u034vT8SJmEZwe6QS17C5qTCZqmYqA&s" alt = "UCF CECS"  width = "70px">
      <div class="content-item">UCF CECS <br /></div>
      <img src="https://lh3.googleusercontent.com/pw/AP1GczOGcEn1Ztbwkhrfkyb6yuhgUvByGfARYW5qJo1iBRDfefpX-fUJWo4DDATe0fBL_UhrGpDTHt72Hg9rUZntqHPWG44bAaOkBBQLNuGnUw-VEtkC0IrizoG_3QHCTrrIcsaR8RJ53w3UoW7PsYvZwO16=w192-h192-s-no-gm?authuser=0" alt="Retengax" width="70px" />
      <div class="content-item">Retengax <br /></div>
      <img src = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQcI8iitb1xCWitrAjcMgtqmkQrGi0aAY9xpf48RKL-O_1GzCPqo5zEkzoOz6CB-GI3wA4&usqp=CAU" alt = "Go Engineer"  width = "70px">
      <div class="content-item">Go Engineer <br /></div>
      <img src = "https://static.wixstatic.com/media/7cdbae_45341b034ab7454fa06333ed8df1fbf8~mv2.png" alt = "Orlando Recycles"  width = "70px">
      <div class="content-item">Orlando Recycles <br /></div>
      <img src = "https://lh3.googleusercontent.com/pw/AP1GczP4LH7ppxLX_QYV_ciUL4052712OmUTUlrC83gwEWenPesQSV5QxB9g94t-4i4wKz9dY7vLJD6zQ9EZ3cW_am3cF70UWLEWWtzOnBSzmksyW8a_m8y8JQaxXR9BTmNUEOLb9LkdnPouzm12eDbQpK-h=w131-h133-s-no-gm?authuser=0" alt = "Protocase"  width = "70px">
      <div class="content-item">Protocase <br /></div>
      <img src = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRwvvA5u034vT8SJmEZwe6QS17C5qTCZqmYqA&s" alt = "UCF CECS"  width = "70px">
      <div class="content-item">UCF CECS <br /></div>
      <img src="https://lh3.googleusercontent.com/pw/AP1GczOGcEn1Ztbwkhrfkyb6yuhgUvByGfARYW5qJo1iBRDfefpX-fUJWo4DDATe0fBL_UhrGpDTHt72Hg9rUZntqHPWG44bAaOkBBQLNuGnUw-VEtkC0IrizoG_3QHCTrrIcsaR8RJ53w3UoW7PsYvZwO16=w192-h192-s-no-gm?authuser=0" alt="Retengax" width="70px" />
      <div class="content-item">Retengax <br /></div>
      <img src = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQcI8iitb1xCWitrAjcMgtqmkQrGi0aAY9xpf48RKL-O_1GzCPqo5zEkzoOz6CB-GI3wA4&usqp=CAU" alt = "Go Engineer"  width = "70px">
      <div class="content-item">Go Engineer <br /></div>
      <img src = "https://static.wixstatic.com/media/7cdbae_45341b034ab7454fa06333ed8df1fbf8~mv2.png" alt = "Orlando Recycles"  width = "70px">
      <div class="content-item">Orlando Recycles <br /></div>
      <img src = "https://lh3.googleusercontent.com/pw/AP1GczP4LH7ppxLX_QYV_ciUL4052712OmUTUlrC83gwEWenPesQSV5QxB9g94t-4i4wKz9dY7vLJD6zQ9EZ3cW_am3cF70UWLEWWtzOnBSzmksyW8a_m8y8JQaxXR9BTmNUEOLb9LkdnPouzm12eDbQpK-h=w131-h133-s-no-gm?authuser=0" alt = "Protocase"  width = "70px">
      <div class="content-item">Protocase <br /></div>
      <img src = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRwvvA5u034vT8SJmEZwe6QS17C5qTCZqmYqA&s" alt = "UCF CECS"  width = "70px">
      <div class="content-item">UCF CECS <br /></div>
      <img src="https://lh3.googleusercontent.com/pw/AP1GczOGcEn1Ztbwkhrfkyb6yuhgUvByGfARYW5qJo1iBRDfefpX-fUJWo4DDATe0fBL_UhrGpDTHt72Hg9rUZntqHPWG44bAaOkBBQLNuGnUw-VEtkC0IrizoG_3QHCTrrIcsaR8RJ53w3UoW7PsYvZwO16=w192-h192-s-no-gm?authuser=0" alt="Retengax" width="70px" />
      <div class="content-item">Retengax <br /></div>
      <img src = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQcI8iitb1xCWitrAjcMgtqmkQrGi0aAY9xpf48RKL-O_1GzCPqo5zEkzoOz6CB-GI3wA4&usqp=CAU" alt = "Go Engineer"  width = "70px">
      <div class="content-item">Go Engineer <br /></div>
      <img src = "https://static.wixstatic.com/media/7cdbae_45341b034ab7454fa06333ed8df1fbf8~mv2.png" alt = "Orlando Recycles"  width = "70px">
      <div class="content-item">Orlando Recycles <br /></div>
      <img src = "https://lh3.googleusercontent.com/pw/AP1GczP4LH7ppxLX_QYV_ciUL4052712OmUTUlrC83gwEWenPesQSV5QxB9g94t-4i4wKz9dY7vLJD6zQ9EZ3cW_am3cF70UWLEWWtzOnBSzmksyW8a_m8y8JQaxXR9BTmNUEOLb9LkdnPouzm12eDbQpK-h=w131-h133-s-no-gm?authuser=0" alt = "Protocase"  width = "70px">
      <div class="content-item">Protocase <br /></div>
      <img src = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRwvvA5u034vT8SJmEZwe6QS17C5qTCZqmYqA&s" alt = "UCF CECS"  width = "70px">
      <div class="content-item">UCF CECS <br /></div>

    </div>
  </div>
</div>

<!-- Kits Sponsorship Tiers -->
<div bind:this={mainEle} class="absolute top-0 left-0 right-0 bottom-0 pointer-events-auto -z-20" />
<div
  class="h-screen grid place-items-center w-screen top-0 pointer-events-none mt-[50px] pb-[130px]"
>
  <div
    class={$modeCurrent
      ? 'block card p-8 pointer-events-auto shadow-xl shadow-surface-300'
      : 'block card p-8 pointer-events-auto shadow-xl shadow-surface-500'}
  >
    <div class="m-4 centered">
      <div class="sponsorContainer sponsor-wrapper">
        <div class="centered">
          <div class="h1 text-[5rem] leading-[5rem]">
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
                  <a href="https://www.goengineer.com/">
                    <img src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQcI8iitb1xCWitrAjcMgtqmkQrGi0aAY9xpf48RKL-O_1GzCPqo5zEkzoOz6CB-GI3wA4&usqp=CAU" alt="Go Engineer" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="https://www.retengax.com.br/">
                    <img src="https://lh3.googleusercontent.com/pw/AP1GczOGcEn1Ztbwkhrfkyb6yuhgUvByGfARYW5qJo1iBRDfefpX-fUJWo4DDATe0fBL_UhrGpDTHt72Hg9rUZntqHPWG44bAaOkBBQLNuGnUw-VEtkC0IrizoG_3QHCTrrIcsaR8RJ53w3UoW7PsYvZwO16=w192-h192-s-no-gm?authuser=0" alt="Retengax" />
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
                  <a href="https://www.orlandorecycles.com/">
                    <img src="https://static.wixstatic.com/media/7cdbae_45341b034ab7454fa06333ed8df1fbf8~mv2.png" alt = "Orlando Recycles" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="https://www.protocase.com/">
                    <img src="https://lh3.googleusercontent.com/pw/AP1GczP4LH7ppxLX_QYV_ciUL4052712OmUTUlrC83gwEWenPesQSV5QxB9g94t-4i4wKz9dY7vLJD6zQ9EZ3cW_am3cF70UWLEWWtzOnBSzmksyW8a_m8y8JQaxXR9BTmNUEOLb9LkdnPouzm12eDbQpK-h=w131-h133-s-no-gm?authuser=0" alt = "Protocase" />
                  </a>
                </div>
                <div class="sponsor-logo">
                  <a href="https://www.cecs.ucf.edu/">
                    <img src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRwvvA5u034vT8SJmEZwe6QS17C5qTCZqmYqA&s" alt = "UCF CECS" />
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
                <div class = "sponsor-logo">
                  <a href="https://www.redbull.com/us-en">
                  <img src = "https://cdn.brandfetch.io/iddByYpFsc/w/400/h/400/theme/dark/icon.png?c=1bxid64Mup7aczewSAYMX&t=1667560742112" alt = "RedBull">
                </a>
                </div>
                <div class="sponsor-logo">
                  <a href="https://sendcutsend.com/">
                    <img src="https://www.svgrepo.com/show/331572/sendcutsend.svg" alt = "SendCutSend" />
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
                  <a href="https://www.gobilda.com/">
                    <img src="https://lh3.googleusercontent.com/pw/AP1GczMtxPR3SMWXkulENPr2NDN-K328CRuYgLIb7PJDBw748kpAIAUPfwd3VlaDKhde5UaRD9WdvFxhzPHl2fxaOewwHXYchMc_4qpkjx7rvVWrGy6FjoPCs5upzqlS-13memuceAnk-JU75v_43NDJssYH=w900-h900-s-no-gm?authuser=0" alt="GoBilda" />
                  </a>
                </div>
              </div>
            </ul>
          </div>
        </div>
      </div>

      <hr class="border" />
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

</div>
