<?php

// header functions and include
include_once("../assets/templates/header.php");
$pageDescription = "In 2017, the Robotics Club of Central Florida focused on an autonomous octacopter and a demonstrative robot.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, past projects 2019, past projects, demobot, laki2";
$headerGen = new Header("Alexandra French", "August 5, 2020", "Alexandra French", "November 12, 2020");
$headerGen->generateComment();
$headerGen->generateCommon("Robotics Club 2019 Projects", $pageDescription, $keywords, "https://robotics.ucf.edu/projects/2019");
$headerGen->generateCSS();
$headerGen->genWebsiteSEO("https://robotics.ucf.edu/projects/2019", "Robotics Club 2019 Projects", $pageDescription, "https://robotics.ucf.edu/projects/assets/imgs/demobot-2019.jpg");
$headerGen->endHeader();


// navbar
include_once("../assets/templates/navbar.php");
$navbarGen = new Navbar(False);

?>

<!-- Page Content -->
<div class="container">

  <!-- our projects header -->
  <div class="header-container-sm">
    <h1 class="mt-4 mb-3 text-center rounded p-1 title-blk-gold">Our Projects
    </h1>

    <!-- Image Header -->
    <img class="img-fluid rounded mb-2" src="assets/imgs/header-2019.jpg" alt="bowser">

    <!-- text content -->
    <div class="row align-items-center justify-content-center text-center">
      <div class="col-lg-12">
        <div class="container-wht-blk rounded p-3">
          <p>The Robotics Club of Cental Florida is dedicated to producing new, innovative
             robots that challenge all aspects and majors of the club each year. Our Projects
             involve mechanical, electrical, and computer engineers as well as computer scientists
             to achieve overall project goals.
          </p>
          <p>This year, our flagship robots are Laki2, a 15lb combat robot, and
             Demobot, an autonomous ground vehicle. Together, they offered a comprehensive
             chance to tackle mechanical and software challenges!
          </p>
        </div>
      </div>
    </div>
  </div>
  <!-- /.our projects -->

  <h2 class="text-center p-1 title-blk-wht">2018-2019</h2>

  <!-- projects -->
  <div class="intermediate-container-xs">
    <?php
        include("assets/templates/project.php");
        $project = new Project();
        
        $description = "Laki2 was an autonomous octocopter. Laki2 involved computer vision and mechanical work.
         Its parts were taken from its predecesor: <a href=\"lakitu/index\">Lakitu</a>.
         Mechanical aspects involved improving the cameras and communication links.
         It was created for the AUVSI SAUS competition";
        $project->generate("Laki2", "assets/imgs/laki2.jpg", "laki2", $description, "View Laki2", "laki2/index");
    
        $description = "Demobot stands for demonstrative robot. This bot is part of a multi-robot long
        tradition to build robots that can demonstrate all aspects of robotics to an audience.
        This demobot involved a modular ground roaming unit. It was demonstrated to a high school.";
        $project->generate("Demobot", "assets/imgs/demobot-2019.jpg", "demobot 2019", $description, "View Demobot", "demobot-2019/index");
        
    ?>

  </div>
  <!-- /.projects -->

  <?php
    require_once("../assets/templates/pagination-bottom.php");
    $pagination = new Pagination(2019, "index", 2018);
    $pagination->generate(array("index", 2019, 2018, 2017), TRUE);
  ?>
  
  </div>
  <!-- /.container -->

<?php

// footer functions and include
include_once("../assets/templates/footer.php");
$footerGen = new Footer();
$footerGen->generateFooter();
$footerGen->generateJs();
$footerGen->endFile();

?>
