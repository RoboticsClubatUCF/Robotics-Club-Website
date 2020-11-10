<?php
  include_once('assets/templates/personnel.php');
  $advisorGen = new Personnel();
?>

  <!-- Page Content -->
  <div class="container">
    <!-- advisors -->
    <div class="intermediate-container-med">
      <h2 class="rounded p-1 text-center title-blk-wht">Our Advisors</h2>
      <!-- row 1 (main advisor) -->
      <div class="row">
        <div class="col-lg mb-4">
          <?php
                $advisorGen->generatePersonnel("Crystal Maraj", "Faculty Advisor", "assets/imgs/about/crystal.jpg", "club advisor maraj");
          ?>
        </div>
      </div>
      <!-- /.row1 -->
      <!-- row 2 (discipline specific advisors) -->
      <div class="row">
        <div class="col-lg mb-4">
          <?php
                $advisorGen->generatePersonnel("ChungYong Chan", "Electrical Project Advisor", "assets/imgs/about/chan.jpg", "electrical project advisor chan");
          ?>
        </div>
        <div class="col-lg mb-4">
          <?php
                $advisorGen->generatePersonnel("Joon Park", "Mechanical Project Advisor", "assets/imgs/about/park.jpg", "mechanical project advisor park");
          ?>
        </div>
      </div>
      <!-- /.row2 -->
    </div>
    <!--- advisors -->
  </div>
  <!-- /.container -->
