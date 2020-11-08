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
          <h2 class="rounded p-1 text-center title-blk-gold">2019 - 2020</h2>

          <!-- row 1 (president & vice president) -->
          
          <div class="row">
            <div class="col-lg mb-4">
            <?php
              $description = "Managed the entire club, ensured all training, and brought us above and beyond during difficult times.";
              $officerGen->generateOfficer("Salomon Hassidoff", "President", "assets/imgs/old-officers/2020/salomon-hassidoff.jpg", "president sal", "Mechanical Engineer", $description);
            ?>
            </div>
            <div class="col-lg mb-4">
            <?php
              $description = "Co-managed the entire club, ensured all training, and brought us above and beyond during difficult times.";
              $officerGen->generateOfficer("Alan Mark", "Vice President", "assets/imgs/old-officers/2020/alan-mark.jpg", "vice president alan", "Mechanical Engineer", $description);
            ?>
            </div>
          </div>
          <!-- /.row 1 -->
          <!-- row 2 (treasurer, webmaster, secretary)-->
          <div class="row">
            <div class="col-lg mb-4">
            <?php
              $description =  "Kept track of all of the club's finances. Managed much of the club official documents.";
              $officerGen->generateOfficer("Wesley Fletcher", "Treasurer", "assets/imgs/old-officers/2020/wesley-fletcher.jpg", "treasurer wesley", "Computer Engineer", $description);
            ?>
            </div>
            <div class="col-lg mb-4">
            <?php
              $description = "Created the website from scratch in 2020. Managed all of the club social media.";
              $officerGen->generateOfficer("Alexandra French", "Webmaster", "assets/imgs/old-officers/2020/alexandra-french.png", "webmaster french", "Computer Scientist", $description);
            ?>
            </div>
            <div class="col-lg mb-4">
            <?php
              $description =  "Kept tabs on our club meetings and managed all of the club meeting notes.";
              $officerGen->generateOfficer("Marcus Simmonds", "Secretary", "assets/imgs/old-officers/2020/marcus-simmonds.jpg", "secretary marc", "Computer Engineer", $description);
            ?>
            </div>
          </div>
          <!-- /.row 2 -->
          <!-- row 3 (lab manager and marketing/pr) -->
          <div class="row">
            <div class="col-lg mb-4">
            <?php
              $description =  "Ensured lab safety. Reorganized the entire lab and started up tracking inventory.";
              $officerGen->generateOfficer("Dwight Howard II", "Lab Manager", "assets/imgs/old-officers/2020/dwight-howard.jpg", "Lab Manager Dwight", "Mechanical Engineer", $description);
            ?>
            </div>
            <div class="col-lg mb-4">
            <?php
              $description =  "Created t-shirt and other such merchandise design. Took care of related processing.";
              $officerGen->generateOfficer("Azeem Barton", "Marketing & PR", "assets/imgs/old-officers/2020/azeem-barton.jpg", "marketing wesley", "Graphic Design", $description);
            ?>
            </div>
            <div class="col-lg mb-4">
            <?php
              $description =  "Worked with our logo designs and designed all of our advertising posters.";
              $officerGen->generateOfficer("Sheina Rodriguez", "Marketing & PR", "assets/imgs/old-officers/2020/sheina-rodriguez.jpg", "marketing & pr sheina", "Mechanical Engineer", $description);
            ?>
            </div>
          </div>
          <!-- /.row 3 -->
        </div>
        <!-- officers -->
      </div>
      <!-- /.2019-2020 -->
      <!-- 2018-2019-->
      <div class="tab-pane container fade" id="fa2018">
        <!-- officers -->
        <div class="intermediate-container-xs">
          <h2 class="rounded p-1 text-center title-blk-gold">2018 - 2019</h2>

          <!-- row 1 (president & vice president) -->
          <div class="row">
            <div class="col-lg mb-3">
            <?php
              $officerGen->generateOfficer("Jade Zsiros", "President", "assets/imgs/old-officers/2019/jade-zsiros.jpg", "president jade", "Computer Engineer");
            ?>
            </div>
            <div class="col-lg mb-3">
            <?php
              $officerGen->generateOfficer("Brian Blalock", "Vice President", "assets/imgs/old-officers/2019/brian-blalock.jpg", "vice president brian", "Computer Scientist");
            ?>
            </div>
          </div>
          <!-- /.row 1 -->
          <!-- row 2 (treasurer & historian/marketing)-->
          <div class="row">
            <div class="col-lg mb-4">
            <?php
              $officerGen->generateOfficer("Darien Craig", "Treasurer", "assets/imgs/old-officers/2019/darien-craig.jpg", "treasurer darien", "Computer Scientist");
            ?>
            </div>
            <div class="col-lg mb-4">
            <?php
              $officerGen->generateOfficer("Chad Pauley", "Marketing/Historian", "../assets/imgs/placeholder-750x750.jpg", "historian chad", "Computer Engineer");
            ?>
            </div>
          </div>
          <!-- /.row 2 -->
        </div>
        <!-- officers -->
      </div>
      <!-- /.2018-2019-->
      <!-- 2017-2018 -->
      <div class="tab-pane container fade" id="fa2017">
        <!-- officers -->
        <div class="intermediate-container-xs">
          <h2 class="rounded p-1 text-center title-blk-gold">2017 - 2018</h2>

          <!-- row 1 (president) -->
          <div class="row">
            <div class="col-lg mb-3">
            <?php
              $officerGen->generateOfficer("Nick Peters", "President");
            ?>
            </div>
          </div>
          <!-- /.row 1 -->
          <!-- row 2 (vice president)-->
          <div class="row">
            <div class="col-lg mb-3">
            <?php
              $officerGen->generateOfficer("Jade Zsiros", "Vice President");
            ?>
            </div>
          </div>
          <!-- /.row 2 -->
          <!-- row 3 (treasurer)-->
          <div class="row">
            <div class="col-lg mb-4">
            <?php
              $officerGen->generateOfficer("Casey Brennan", "Treasurer");
            ?>
            </div>
          </div>
          <!-- /.row 3 -->
          <!-- row 4 (secretary)-->
          <div class="row">
            <div class="col-lg mb-4">
            <?php
              $officerGen->generateOfficer("Ori Leidovici", "Secretary");
            ?>
            </div>
          </div>
          <!-- /.row 4 -->
          <!-- row 5 (historian)-->
          <div class="row">
            <div class="col-lg mb-4">
            <?php
              $officerGen->generateOfficer("Connor Cole", "Historian");
            ?>
            </div>
          </div>
          <!-- /.row 5 -->
          <!-- row 6 (marketing)-->
          <div class="row">
            <div class="col-lg mb-4">
            <?php
              $officerGen->generateOfficer("Connor Trottman", "Marketing");
            ?>
            </div>
          </div>
          <!-- /.row 6 -->
        </div>
        <!-- officers -->
      </div>
      <!-- /.2017-2018 -->
      <!-- 2016-2017 -->
      <div class="tab-pane container fade" id="fa2016">
        <!-- officers -->
        <div class="intermediate-container-xs">
          <h2 class="rounded p-1 text-center title-blk-gold">2016 - 2017</h2>

          <!-- row 1 (president -->
          <div class="row">
            <div class="col-lg mb-3">
            <?php
              $officerGen->generateOfficer("Eddie Grekoski", "President");
            ?>
            </div>
          </div>
          <!-- /.row 1 (president) -->
          <!-- row 2 (vice president) -->
          <div class="row">
            <div class="col-lg mb-3">
            <?php
              $officerGen->generateOfficer("Nick Peters", "Vice President");
            ?>
            </div>
          </div>
          <!-- /.row 2 -->
          <!-- row 3 (treasurer)-->
          <div class="row">
            <div class="col-lg mb-4">
            <?php
              $officerGen->generateOfficer("Brian", "Treasurer");
            ?>
            </div>
          </div>
          <!-- /.row 3 -->
          <!-- row 4 (secretary) -->
          <div class="row">
            <div class="col-lg mb-4">
            <?php
              $officerGen->generateOfficer("Unknown", "Secretary");
            ?>
            </div>
          </div>
          <!-- /.row 4 -->
          <!-- row 5 (historian) -->
          <div class="row">
            <div class="col-lg mb-4">
            <?php
              $officerGen->generateOfficer("Stephen Sumner", "Historian");
            ?>
            </div>
          </div>
          <!-- /.row 5 -->
          <!-- row 6 (marketing) -->
          <div class="row">
            <div class="col-lg mb-4">
            <?php
              $officerGen->generateOfficer("Jade Zsiros", "Marketing");
            ?>
            </div>
          </div>
          <!-- /.row 6 -->
        </div>
        <!-- officers -->
      </div>
      <!-- /.2016-2017 -->
      <!-- 2015-2017 -->
      <div class="tab-pane container fade" id="fa2015">
        <!-- officers -->
        <div class="intermediate-container-xs">
          <h2 class="rounded p-1 text-center title-blk-gold">2015 - 2016</h2>

          <!-- row 1 (president & vice president) -->
          <div class="row">
            <div class="col-lg mb-3">
            <?php
              $officerGen->generateOfficer("John Millner", "President");
            ?>
            </div>
          </div>
          <!-- /.row 1 (president & vice president) -->
          <!-- row 2 (vice prsident) -->
          <div class="row">
            <div class="col-lg mb-3">
            <?php
              $officerGen->generateOfficer("Therese Sales", "Vice President");
            ?>
            </div>
          </div>
          <!-- /.row 2 -->
          <!-- row 3 (treasurer)-->
          <div class="row">
            <div class="col-lg mb-4">
            <?php
              $officerGen->generateOfficer("Ryker Chute", "Treasurer");
            ?>
            </div>
          </div>
          <!-- /.row 3 -->
          <!-- row 4 (secretary)-->
          <div class="row" style="padding-bottom: 150px;">
            <div class="col-lg mb-4">
            <?php
              $officerGen->generateOfficer("Eddie Grekoski", "Secretary");
            ?>
            </div>
          </div>
          <!-- /.row 4 -->
        </div>
        <!-- officers -->
      </div>
      <!-- /.2015-2016 -->
    </div>
    <!-- /.tab content -->