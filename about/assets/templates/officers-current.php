<?php
  include_once('assets/templates/officer.php');
  $officerGen = new Officer();
?>


    <!-- tab content for officers -->
    <div class="tab-content">
      <!-- 2019-2020 -->
      <div class="tab-pane container active" id="fa2019">
        <!-- officers -->
        <div class="intermediate-container-xs">
          <h2 class="rounded p-1 text-center title-blk-gold">Current Officers</h2>

          <!-- row 1 (president & vice president) -->
          <div class="row">
            <div class="col-lg mb-3">
              <?php
                $description = "Managed the entire club, ensured all training, and brought us above and beyond during difficult times.";
                $officerGen->generateOfficer("Salomon Hassidoff", "President", "assets/imgs/about/salomon-hassidoff.jpg", "president sal", "Mechanical Engineer", $description);
              ?>
            </div>
            <div class="col-lg mb-3">
              <?php
                $description = "Co-managed the entire club, ensured all training, and brought us above and beyond during difficult times.";
                $officerGen->generateOfficer("Alan Mark", "Vice President", "assets/imgs/about/alan-mark.jpg", "vice president alan", "Mechanical Engineer", $description);
              ?>
            </div>
          </div>
          <!-- /.row 1 -->
          <!-- row 2 (treasurer, webmaster, secretary) -->
          <div class="row">
            <div class="col-lg mb-4">
              <?php
                $description =  "Kept track of all of the club's finances. Managed much of the club official documents.";
                $officerGen->generateOfficer("Wesley Fletcher", "Treasurer", "assets/imgs/about/wesley-fletcher.jpg", "treasurer wesley", "Computer Engineer", $description);
              ?>
            </div>
            <div class="col-lg mb-4">
              <?php
                $description = "Created the website from scratch in 2020. Managed all of the club social media.";
                $officerGen->generateOfficer("Alexandra French", "Webmaster", "assets/imgs/about/alexandra-french.png", "webmaster french", "Computer Scientist", $description);
              ?>
            </div>
            <div class="col-lg mb-4">
              <?php
                $description =  "Kept tabs on our club meetings and managed all of the club meeting notes.";
                $officerGen->generateOfficer("Marcus Simmonds", "Secretary", "assets/imgs/about/marcus-simmonds.jpg", "secretary marc", "Computer Engineer", $description);
              ?>
            </div>
          </div>
          <!-- /.row 2 -->
          <!-- row 3 (lab manager and marketing/pr) -->
          <div class="row">
            <div class="col-lg mb-4">
              <?php
                $description =  "Ensured lab safety. Reorganized the entire lab and started up tracking inventory.";
                $officerGen->generateOfficer("Dwight Howard II", "Lab Manager", "assets/imgs/about/dwight-howard.jpg", "Lab Manager Dwight", "Mechanical Engineer", $description);
              ?>
            </div>
            <div class="col-lg mb-4">
              <?php
                $description =  "Created t-shirt and other such merchandise design. Took care of related processing.";
                $officerGen->generateOfficer("Azeem Barton", "Marketing & PR", "assets/imgs/about/azeem-barton.jpg", "marketing wesley", "Graphic Design", $description);
              ?>
            </div>
            <div class="col-lg mb-4">
              <?php
                $description =  "Worked with our logo designs and designed all of our advertising posters.";
                $officerGen->generateOfficer("Sheina Rodriguez", "Marketing & PR", "assets/imgs/about/sheina-rodriguez.jpg", "marketing & pr sheina", "Mechanical Engineer", $description);
              ?>
            </div>
          </div>
          <!-- /.row 3 -->
        </div>
        <!-- /.officers -->
      </div>
      <!-- /.2019-2020 -->
    </div>
    <!-- /.tab content -->