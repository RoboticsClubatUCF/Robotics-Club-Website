<?php
  // This class generates the footer, javascript, and end of file
  // Created by Alexandra French on 11/9/2020
  // Last updated on 11/9/2020


  class Footer {
  
    public function __construct() {
    }
    
    // generates a footer with the entered year. If sized, sets to mobile/large screen specific sizes.
    public function generateFooter ($sized) {
      echo "\n  <!-- Footer -->";
      
      // setup footer to be different padding for sized and not
      echo "\n  <footer class=\"py-";
      if ($sized) {
        echo "2";
      } else {
        echo "3";
      }
      echo " bg-clear\">";
      
      // unsized footer is within a container
      echo "\n    <div class=\"container\">";
      echo "\n      <div class=\"row\">";
      echo "\n        <p class=\"col-";
      if (!$sized) {
        echo "lg";
      } else {
        echo "md";
      }
      echo "-4 m-0 text-center text-white\">Copyright &copy; 2003-2020";
      if (!$sized) {
        echo "\n          <br> Robotics Club of Central Florida";
      }
      echo "\n        </p>";
      echo "\n        <p class=\"col-";
      if (!$sized) {
        echo "lg";
      } else {
        echo "md";
      }
      echo "-4 text-center text-white";
      if ($sized) {
        echo " d-none d-lg-block";
      }
      echo "\">3100 Technology Parkway";
      echo "\n          <br>Orlando, FL 32826";
      echo "\n        </p>";
      echo "\n        <p class=\"col-";
      if (!$sized) {
        echo "lg";
      } else {
        echo "md";
      }
      echo "-4 text-center text-white";
      if ($sized) {
         echo " d-none d-md-block";
      }
      echo "\">";
      echo "\n          <a href=\"https://facebook.com/RoboticsClub\" aria-label=\"Robotics Club facebook\"><img src=\"/assets/imgs/footer/facebook.png\" alt=\"facebook mini logo\"></a>
          <a href=\"https://instagram.com/RoboticsClubCFl\" aria-label=\"Robotics Club instagram\"><img src=\"/assets/imgs/footer/instagram.png\" alt=\"instagram mini logo\"></a>
          <a href=\"https://twitter.com/RoboticsClubCFl\" aria-label=\"Robotics Club twitter\"><img src=\"/assets/imgs/footer/twitter.png\" alt=\"twitter mini logo\"></a>
          <a href=\"https://www.youtube.com/channel/UCZEPdNUFzkciC7MIiI-yPKg\" aria-label=\"Robotics Club youtube\"><img src=\"/assets/imgs/footer/youtube.png\" alt=\"youtube mini logo\"></a>
        </p>
      </div>";
      echo "\n    </div>";
      echo "\n  </footer>";
      echo "\n  <!-- /.footer -->";  
    }
    
    // generates all js. Optional array of custom js to generate.
    public function generateJs($customJs) {
      echo "  <!-- js -->";
      echo "\n  <!-- Bootstrap -->";
      echo "\n  <script src=\"/assets/rsrc/jquery/jquery.min.js\"></script>";
      echo"\n  <script src=\"/assets/rsrc/bootstrap/js/bootstrap.bundle.min.js\"></script>";
      echo "\n\n  <!-- custom js styles -->";
      echo "\n  <script src=\"/assets/js/global-scripts.js\"></script>";
  
      if (!empty($customJs)) {
        $this->customJsStyles($customJs);
      }
    }
  
    // takes an array of styles and generates them as js scripts
    private function customJsStyles($customJs) {
      echo "\n\n<!-- Additional js styles -->";
      foreach ($customJs as $currentJs) {
        echo "<script src=\"";
        echo $currentJs;
        echo "\"></script>";
      }
    }
    
    // closes body and html
    public function endFile() {
      echo "\n\n</body>";
      echo "\n\n</html>";
    }
  }

?>