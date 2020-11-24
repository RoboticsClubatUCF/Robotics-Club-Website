<?php
  include_once('assets/templates/personnel.php');
  $officerGen = new Personnel();
?>


    <!-- tab content for officers -->
    <div class="tab-content">
      <!-- 2020-2021 -->
      <div class="tab-pane container active" id="fa2020">
        <!-- officers -->
        <div class="intermediate-container-xs">
          <h2 class="rounded p-1 text-center title-blk-gold">2020-2021</h2>

          <!-- row 1 (president & vice president) -->
          <div class="row justify-content-center">
            <div class="col-lg mb-3">
              <?php
                $description = "Our new president for the 2021 year.";
                $officerGen->generatePersonnel("Wesley Fletcher", "President", "assets/imgs/old-officers/2021/wesley-fletcher.jpg", "president wesley", "Computer Engineer", $description);
              ?>
            </div>
            <div class="col-lg mb-3">
              <?php
                $description = "Our Vice President for the new year.";
                $officerGen->generatePersonnel("Alexandra French", "Vice President", "assets/imgs/old-officers/2021/alexandra-french.png", "vice president alex", "Computer Scientist", $description);
              ?>
            </div>
          </div>
          <!-- /.row 1 -->
          <!-- row 2 (treasurer, webmaster, secretary) -->
          <div class="row justify-content-center">
            <div class="col-lg mb-4">
              <?php
                $description =  "Our new treasurer for 2021.";
                $officerGen->generatePersonnel("Marcus Simmonds", "Treasurer", "assets/imgs/old-officers/2021/marcus-simmonds.jpg", "treasurer wesley", "Computer Engineer", $description);
              ?>
            </div>
            <div class="col-lg mb-4">
              <?php
                $description = "Our new Webmaster for 2021.";
                $officerGen->generatePersonnel("Robert Martin", "Webmaster", "assets/imgs/old-officers/2021/robert-martin.jpg", "webmaster robert", "Computer Scientist", $description);
              ?>
            </div>
            <div class="col-lg mb-4">
              <?php
                $description =  "A new secretary for 2021.";
                $officerGen->generatePersonnel("Vijay Stroup", "Secretary", "assets/imgs/old-officers/2021/vijay-stroup.jpg", "secretary vijay", "Computer Scientist", $description);
              ?>
            </div>
          </div>
          <!-- /.row 2 -->
          <!-- row 3 (lab manager and marketing/pr) -->
          <div class="row justify-content-center">
            <div class="col-lg-4 mb-4">
              <?php
                $description =  "Our continuing lab manager for 2021.";
                $officerGen->generatePersonnel("Dwight Howard II", "Lab Manager", "assets/imgs/old-officers/2021/dwight-howard.jpg", "Lab Manager Dwight", "Mechanical Engineer", $description);
              ?>
            </div>
            <div class="col-lg-4 mb-4">
              <?php
                $description =  "Our new marketing and PR officer for 2021.";
                $officerGen->generatePersonnel("Jennifer Olenchak", "Marketing & PR", "assets/imgs/old-officers/2021/jennifer-olenchak.jpeg", "marketing officer jennifer", "Computer Scientist", $description);
              ?>
            </div>
          </div>
          <!-- /.row 3 -->
        </div>
        <!-- /.officers -->
      </div>
      <!-- /.2020-2021 -->
    </div>
    <!-- /.tab content -->