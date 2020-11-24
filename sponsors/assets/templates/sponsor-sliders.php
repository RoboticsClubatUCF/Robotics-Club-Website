<?php
  include_once('assets/templates/sponsor.php');
  $sponsorGen = new Sponsor();
?>

    <!-- Sponsors first row -->
    <div class="row">
      <!-- sponsor 1 -->
      <div class="col-lg-4 mb-4">
        <div class="slide-container"><div class="slide-child">
          <?php
            $description = "The Institute for Simulation and Training provides an excellent
                lab space in partnership 2 and other support significant support. They are an internationally
                recognized research institute.";
            $sponsorGen->generateSponsor("IST", "assets/imgs/ist.jpg", "IST logo", $description, "http://www.ist.ucf.edu/");
          ?>
        </div></div>
      </div>
      <!-- /.sponsor 1 -->
      <!-- sponsor 2 -->
      <div class="col-lg-4 mb-4">
        <div class="slide-container"><div class="slide-child">
          <?php
              $description = "Don Vo has provided an extremely generous level of funding
                  towards getting our club running during 2020. Thanks to this donation, we've been able to
                  get our robots and workshops components.";
              $sponsorGen->generateSponsor("Don Vo &#128020", "assets/imgs/donvo.jpg", "Don Vo logo", $description, "https://github.com/chickenfromouterspace");
          ?>
        </div></div>
      </div>
      <!-- /.sponsor 2 -->
      <!-- sponsor 3 -->
      <div class="col-lg-4 mb-4">
        <div class="slide-container"><div class="slide-child">
          <?php
              $description = "Texas Instruments has generously provided us with
                  multiple components, workshops, and bots to practice on. They focus on global semiconductor
                  design and integrated circuits.";
              $sponsorGen->generateSponsor("TI", "assets/imgs/ti.jpg", "texas instruments logo", $description, "https://www.ti.com/");
          ?>
        </div></div>
      </div>
      <!-- /.sponsor 3 -->
    </div>
    <!-- /.sponsors row 1 -->

    <!-- sponsors second row -->
    <div class="row">
      <!-- sponsor 1 -->
      <div class="col-lg-4 mb-4">
        <div class="slide-container"><div class="slide-child">
          <?php
              $description = "SolidCAM generously provided an integrated
                  Computer Aided Machining package for SolidWorks to help machine the parts we design in SolidWorks.";
              $sponsorGen->generateSponsor("SolidCAM", "assets/imgs/solidcam.jpg", "SolidCAM logo", $description, "https://www.solidcam.com/");
          ?>
        </div></div>
      </div>
      <!-- /.sponsor 1 -->
      <!-- sponsor 2 -->
      <div class="col-lg-4 mb-4">
        <div class="slide-container"><div class="slide-child">
          <?php
              $description = "The United States Army Research Laboratory has provided
                  a generous level of funding that allowed us to purchase critical
                  parts for our robots.";
              $sponsorGen->generateSponsor("US ARL", "assets/imgs/arl.jpg", "ARL logo", $description, "https://www.arl.army.mil/");
          ?>
        </div></div>
      </div>
      <!-- /.sponsor 2 -->
      <!-- sponsor 3 -->
      <div class="col-lg-4 mb-4">
        <div class="slide-container"><div class="slide-child">
          <?php
                $description = "Digi-Key has granted us discounts on critical electronics for our custom
                  PCB assemblies. They stock and distribute electronic components.";
                $sponsorGen->generateSponsor("Digi-Key", "assets/imgs/digi-key.jpg", "Digi-Key logo", $description, "https://www.digikey.com/");
          ?>
        </div></div>
      </div>
      <!-- /.sponsor 3 -->
    </div>
    <!-- /.sponsor row 2 -->
