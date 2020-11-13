<?php

// header content
include_once('assets/templates/header.php');
$pageDescription = "The Robotics Club of Central Florida is a student powered club based on hands on work with autonomous robotics.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club";
$headerGen = new Header("Alexandra French", "August 5, 2020", "Alexandra French", "November 12, 2020");
$headerGen->generateComment();
$headerGen->generateCommon("Robotics Club of Central Florida", $pageDescription, $keywords, "https://robotics.ucf.edu/");
$headerGen->generateCSS(array("assets/css/index.css"));
$headerGen->genOrgSEO("https://robotics.ucf.edu/", "Robotics Club of Central Florida", $pageDescription, "(407) 882-0293", "robotics@ucf.edu", "https://robotics.ucf.edu/assets/imgs/bowser.jpg");
$headerGen->endHeader();

// include and classes for generation
include_once('assets/templates/navbar.php');
  
include_once('assets/templates/slideshows.php');
$slideshowGen = new Slideshows();
  
include_once('assets/templates/footer.php');
$footerGen = new Footer();

?>


<body>  
  <div class="page-container">
  
  <?php
    $navbarGen = new Navbar(True);
  ?>

  <!-- snap container for page -->
  <div class="snapper y mandatory-snapping">
    <!-- snap slideshow and news -->
    <div class="snap-child justify-content-center align-items-center">
      <?php
        $images = array("assets/imgs/home/roboticsSlide.jpg", "assets/imgs/home/innovationSlide.jpg", "assets/imgs/home/successSlide.jpg");
        $slideshowGen->generateWideSlideshow(3, $images, array("Robotics", "Innovation", "Success"));
      ?>

      <!-- Page Content Container 1 -->
      <div class="container">
        <?php
          include_once('assets/templates/announcement-calendar.html')
        ?>
      </div>
      <!-- /.container 1 -->
    </div>
    <!-- snap slideshow and news -->


    <!-- who are we snap container -->
    <div class="snap-child justify-content-center align-items-center">
    <!-- Page Content Container 2 -->
      <div class="container justify-content-center align-items-center">
        <!-- flex containers -->
        <div class="intermediate-container-flex justify-content-center align-items-center">
          <div class="d-flex flex-column justify-content-center align-items-center">
            <!-- intro -->
            <div class="intro justify-content-center align-items-center">
              <!-- title row -->
              <div class="row w-100 no-gutters">
                <div class="col-lg-12">
                  <h2 class="text-center p-2 rounded title-blk-wht w-100 font-weight-bold">Who Are We?</h2>
                </div>
              </div>
              <!-- /.title row -->
              <!-- content row -->
              <div class="row w-100 h-100 no-gutters">
                <div class="col-lg-12">
                  <div class="text-center p-4 container-wht-blk rounded w-100">
                    <div class="d-none d-md-block"><p>Welcome to the Robotics Club of Central Florida.
                      <br> This is an entirely student run organization.
                    </p></div>
                    <div class="d-none d-sm-block">
                      <p>We focus on creating innovative and competitive robots and we are always
                        looking for members join in the advancement of the demanding robotics field.
                      </p>
                   </div>
                    <p>
                        Every year we take on projects that involve
                        demonstrations of robotics, pushing the bounds of automation, and innovative, robust designs.
                    </p>
                    <p>
                      Currently, we are realizing three challenging projects...
                    </p>
                  </div>
                </div>
              </div>
              <!-- /.content row -->
            </div>
            <!-- /.intro -->
          </div>
        </div>
        <!-- flex container -->
      </div>
      <!-- /.page container -->
    </div>
    <!-- /.who we are snap container -->

    <!-- robot slides snap container-->
    <div class="snap-child">
      <!-- Page Content Container 2 -->
      <div class="container">
        <!-- flex containers -->
        <div class="intermediate-container-flex">
          <h2 class="sr-only">Our Robots</h2>
          <?php
            $images = array("assets/imgs/placeholder-600x600.png", "assets/imgs/home/bowser.jpg", "assets/imgs/home/citrobot.jpg");
            $titles = array("Demobot", "Bowser", "Citrobot");
            $captions = array("Demonstrates all aspects of robotics.", "Uses computer vision to avoid objects.", "Our 15lb combat monster.");
            $slideshowGen->generateCircleSlideshow($images, $titles, $captions);
          ?>
        </div>
        <!-- /.flex containers -->
      </div>
      <!-- /.page content container -->
    </div>
    <!-- /.robot slides snapper -->


    <!-- grid snapper -->
    <div class="snap-child justify-content-center align-items-center" id="grid-snapper">
      <!-- flex containers -->
      <div class="end-container-flex justify-self-center align-self-center grid" id="grid-end-1">
        <?php
          include_once("assets/templates/grid.html");
        ?>
      </div>
      <!-- /.page container -->
    </div>
    <!-- /.grid -->


  </div>
  <!-- /.page snap container -->
</div>
<!-- page container -->


<?php
// footer content
include_once('assets/templates/footer.php');
$footerGen = new Footer();

$customJs = array("/assets/js/index.js");
$footerGen->generateJs($customJs);
$footerGen->endFile();

?>
